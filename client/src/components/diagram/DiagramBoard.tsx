/**
 * The palette + the React Flow canvas + the inspector, i.e. everything that needs React Flow's
 * instance (so it renders inside DiagramPanel's ReactFlowProvider).
 *
 * React Flow state lives HERE; SessionPage only sees DiagramDoc. `initialDiagram` is read once, on
 * mount (SessionPage re-keys the panel per question, so a new question remounts it blank or from a
 * resume), and every content or position change is reported back through `onChange`.
 *
 * Moving nodes, snapping, panning, box-select and connecting are all React Flow's. The only drag code
 * here is palette -> canvas, as native HTML5 drag-and-drop (React Flow's own drag-and-drop pattern).
 *
 * Copy/paste (Ctrl/Cmd+C, V) and undo/redo (Ctrl/Cmd+Z, Shift+Z or Y) are here too. Both live in this
 * board, so they reset with it on each new question.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ArrowClockwise, ArrowCounterClockwise } from "@phosphor-icons/react";
import {
    Background,
    BackgroundVariant,
    ConnectionMode,
    ControlButton,
    Controls,
    MarkerType,
    Panel,
    ReactFlow,
    SelectionMode,
    useEdgesState,
    useNodesState,
    useReactFlow,
    type Connection,
    type EdgeMarker,
    type NodeTypes,
    type XYPosition,
} from "@xyflow/react";
import type { DiagramDoc, DiagramNodeKind } from "../../api";
import {
    DIAGRAM_DRAG_MIME,
    DIAGRAM_GRID,
    DIAGRAM_MAX_EDGES,
    DIAGRAM_MAX_NODES,
    DIAGRAM_PASTE_OFFSET_STEPS,
} from "../../constants";
import { useDiagramHistory } from "../../hooks";
import {
    facingHandles,
    fromDiagramDoc,
    toDiagramDoc,
    type DiagramFlowEdge,
    type DiagramFlowNode,
} from "../../helpers";
import { DiagramEditingContext, type DiagramEditing } from "./DiagramEditingContext";
import DiagramNode from "./DiagramNode";
import DiagramPalette from "./DiagramPalette";
import EdgeInspector from "./EdgeInspector";
import NodeInspector from "./NodeInspector";

// Defined once, outside the component: React Flow warns (and re-mounts every node) if this object
// changes identity between renders.
const NODE_TYPES: NodeTypes = { diagram: DiagramNode };

const ARROW: EdgeMarker = {
    type: MarkerType.ArrowClosed,
    width: 18,
    height: 18,
    color: "var(--color-neutral-400)",
};

// Clicked-in nodes fan out diagonally from the center for this many steps, then start over.
const ADD_NUDGE_STEPS = 6;

export default function DiagramBoard({
    initialDiagram,
    onChange,
    readOnly,
}: {
    initialDiagram: DiagramDoc;
    onChange: (doc: DiagramDoc) => void;
    readOnly: boolean;
}) {
    // Read once: later `initialDiagram` values are ignored (see the header).
    const [initial] = useState(() => fromDiagramDoc(initialDiagram));
    const [nodes, setNodes, onNodesChange] = useNodesState<DiagramFlowNode>(initial.nodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState<DiagramFlowEdge>(initial.edges);
    const { screenToFlowPosition, updateNodeData, updateEdgeData, deleteElements } = useReactFlow<
        DiagramFlowNode,
        DiagramFlowEdge
    >();
    const wrapperRef = useRef<HTMLDivElement | null>(null);

    // ── Undo history ────────────────────────────────────────────────────────────────────────────
    // Every edit calls `snapshot()` just before it changes anything. Inspector typing is coalesced:
    // a run of keystrokes in one field is one undo step, keyed by "<element id>:<field>". Any other
    // edit (or an undo/redo) resets the key, so the next keystroke starts a new step.
    const { takeSnapshot, undo, redo, canUndo, canRedo } = useDiagramHistory(nodes, edges, setNodes, setEdges);
    const lastEditKeyRef = useRef<string | null>(null);
    function snapshot() {
        lastEditKeyRef.current = null;
        takeSnapshot();
    }
    function snapshotEdit(key: string) {
        if (lastEditKeyRef.current === key) return;
        takeSnapshot();
        lastEditKeyRef.current = key;
    }
    function handleUndo() {
        lastEditKeyRef.current = null;
        setEditingId(null);
        undo();
    }
    function handleRedo() {
        lastEditKeyRef.current = null;
        setEditingId(null);
        redo();
    }

    // Report the diagram up. Skipped mid-drag: positions change every frame, and the drag's final
    // change (dragging -> false) reports where the node landed. Selection changes report an identical
    // doc, which costs nothing (toDiagramDoc drops selection).
    useEffect(() => {
        if (nodes.some((node) => node.dragging)) return;
        onChange(toDiagramDoc(nodes, edges));
    }, [nodes, edges, onChange]);

    // ── Adding components ───────────────────────────────────────────────────────────────────────
    // The new node arrives selected (so the inspector opens on it), and a note starts in inline edit,
    // since a note is nothing until it has text.
    const [editingId, setEditingId] = useState<string | null>(null);

    // Put new nodes/edges on the canvas as the only selected things (so the inspector, or a group
    // drag, picks them up right away).
    function appendSelected(newNodes: DiagramFlowNode[], newEdges: DiagramFlowEdge[]) {
        setNodes((current) => [...current.map((n) => ({ ...n, selected: false })), ...newNodes]);
        setEdges((current) => [...current.map((e) => ({ ...e, selected: false })), ...newEdges]);
    }

    function addNode(kind: DiagramNodeKind, position: XYPosition) {
        if (nodes.length >= DIAGRAM_MAX_NODES) return;
        const id = crypto.randomUUID();
        const node: DiagramFlowNode = {
            id,
            type: "diagram",
            position,
            data: { kind, label: "", notes: "" },
            selected: true,
        };
        snapshot();
        appendSelected([node], []);
        if (kind === "text") setEditingId(id);
    }

    // ── Copy / paste ────────────────────────────────────────────────────────────────────────────
    // The clipboard is this board's own (not the system clipboard): the selection as a DiagramDoc,
    // still carrying the original node ids so the copied edges know which copies to join.
    const clipboardRef = useRef<DiagramDoc | null>(null);
    const pasteCountRef = useRef(0);

    // 1. The selected nodes. None selected: nothing to copy (an edge alone has nothing to attach to).
    // 2. The selected edges whose BOTH ends are among them. An edge to an unselected node is left out,
    //    since its copy would have nothing to attach to.
    // 3. A fresh copy restarts the paste cascade.
    function handleCopy(): boolean {
        const copiedNodes = nodes.filter((node) => node.selected);
        if (copiedNodes.length === 0) return false;
        const copiedIds = new Set(copiedNodes.map((node) => node.id));
        const copiedEdges = edges.filter(
            (edge) => edge.selected && copiedIds.has(edge.source) && copiedIds.has(edge.target),
        );
        clipboardRef.current = toDiagramDoc(copiedNodes, copiedEdges);
        pasteCountRef.current = 0;
        return true;
    }

    // 1. Over either cap, paste nothing (silently, like the palette at the node cap).
    // 2. Each paste lands a little further down-right than the last (whole grid steps, so it stays
    //    snapped), so pasting twice doesn't stack copies exactly on top of each other.
    // 3. Every copy gets a fresh id; the map remembers which original it came from.
    // 4. The copied edges are re-pointed at the copies through that map, so the pasted group is wired
    //    like the original but never to it. Both ends of every pasted edge are brand-new nodes, so it
    //    can't duplicate an existing pair (handleConnect's rule 3): no duplicate check needed here.
    function handlePaste(): boolean {
        const clipboard = clipboardRef.current;
        if (!clipboard) return false;
        if (nodes.length + clipboard.nodes.length > DIAGRAM_MAX_NODES) return true;
        if (edges.length + clipboard.edges.length > DIAGRAM_MAX_EDGES) return true;

        pasteCountRef.current += 1;
        const offset = pasteCountRef.current * DIAGRAM_PASTE_OFFSET_STEPS * DIAGRAM_GRID;

        const copyIds = new Map<string, string>();
        const pastedNodes: DiagramFlowNode[] = clipboard.nodes.map((node) => {
            const id = crypto.randomUUID();
            copyIds.set(node.id, id);
            return {
                id,
                type: "diagram",
                position: { x: node.x + offset, y: node.y + offset },
                data: { kind: node.kind, label: node.label, notes: node.notes },
                selected: true,
            };
        });
        const pastedEdges: DiagramFlowEdge[] = clipboard.edges.map((edge) => ({
            id: crypto.randomUUID(),
            source: copyIds.get(edge.source) as string,
            target: copyIds.get(edge.target) as string,
            data: { label: edge.label, bidirectional: edge.bidirectional },
            selected: true,
        }));

        snapshot();
        appendSelected(pastedNodes, pastedEdges);
        return true;
    }

    // ── Keyboard shortcuts ──────────────────────────────────────────────────────────────────────
    // Ctrl/Cmd+C, V, Z only act on the canvas while it's the thing the user last clicked in, so the
    // answer box's own copy/paste/undo are untouched. A listener on the document (rather than on the
    // canvas element) because React Flow doesn't move focus when the empty canvas is clicked.
    const canvasActiveRef = useRef(false);
    useEffect(() => {
        function handlePointerDown(e: PointerEvent) {
            canvasActiveRef.current = wrapperRef.current?.contains(e.target as globalThis.Node) ?? false;
        }
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, []);

    // 1. Only while the canvas is active (and editable), and only with Ctrl/Cmd held.
    // 2. Typing in a field (the inspector, an inline rename) keeps the browser's own text shortcuts.
    // 3. Copy only: if text is highlighted on the page, the browser copies that instead.
    // 4. preventDefault only for a shortcut that did something.
    function handleKeyDown(e: KeyboardEvent) {
        if (readOnly || !canvasActiveRef.current || !(e.ctrlKey || e.metaKey)) return;
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

        const key = e.key.toLowerCase();
        let handled = false;
        if (key === "c") {
            if (window.getSelection()?.toString()) return;
            handled = handleCopy();
        } else if (key === "v") {
            handled = handlePaste();
        } else if ((key === "z" && e.shiftKey) || key === "y") {
            handled = canRedo;
            handleRedo();
        } else if (key === "z") {
            handled = canUndo;
            handleUndo();
        }
        if (handled) e.preventDefault();
    }
    // The listener is bound once and calls whatever handler the ref holds. handleKeyDown is recreated
    // every render (it reads that render's nodes/edges), so the layout effect repoints the ref at the
    // newest one after each render, before the browser can deliver another key.
    const keyDownRef = useRef(handleKeyDown);
    useLayoutEffect(() => {
        keyDownRef.current = handleKeyDown;
    });
    useEffect(() => {
        const listener = (e: KeyboardEvent) => keyDownRef.current(e);
        document.addEventListener("keydown", listener);
        return () => document.removeEventListener("keydown", listener);
    }, []);

    // Dropped from the palette: place it where the pointer let go (screen -> canvas coordinates).
    function handleDrop(e: DragEvent<HTMLDivElement>) {
        e.preventDefault();
        const kind = e.dataTransfer.getData(DIAGRAM_DRAG_MIME) as DiagramNodeKind;
        if (!kind || readOnly) return;
        addNode(kind, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    }
    function handleDragOver(e: DragEvent<HTMLDivElement>) {
        e.preventDefault(); // without this the browser refuses the drop
        e.dataTransfer.dropEffect = "move";
    }

    // Clicked in the palette (also the touch path, since native drag-and-drop is mouse-only). There's
    // no pointer position, so the node goes in the middle of what's visible.
    function handleAdd(kind: DiagramNodeKind) {
        // 1. The canvas box on screen, in screen pixels (left/top/width/height).
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (!rect) return;
        // 2. Its center, still in screen pixels.
        const screenCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        // 3. Screen pixels -> canvas coordinates. The canvas can be panned and zoomed, and node
        //    positions are stored in canvas coordinates: this is the canvas point under that center.
        const center = screenToFlowPosition(screenCenter);
        // 4. Nudge it down-right by 0-5 grid steps (count % 6 cycles 0,1,...,5,0,...), so a few clicks
        //    in a row fan out like stacked cards instead of hiding each other, without drifting off
        //    screen. Whole grid steps keep it aligned with the snap grid. Based on the node count,
        //    so after a delete it can land on an existing node; that's harmless (drag it off).
        const nudge = (nodes.length % ADD_NUDGE_STEPS) * DIAGRAM_GRID;
        addNode(kind, { x: center.x + nudge, y: center.y + nudge });
    }

    // ── Connecting ──────────────────────────────────────────────────────────────────────────────
    // 1. A node can't connect to itself (React Flow would draw a loop the LLMs can't read anything into).
    // 2. Stop at the server's edge cap, so a send never 422s.
    // 3. One connection per pair of nodes, in either direction: a second one is almost always a
    //    mis-drag. For data flowing both ways, the inspector's "Two-way" covers it.
    // The handles the user dragged between are dropped: drawnEdges picks the facing sides instead.
    // Checked against this render's edges (not inside a setEdges updater) so the undo snapshot is taken
    // only when an edge is really added.
    function handleConnect(connection: Connection) {
        const { source, target } = connection;
        if (source === target) return;
        if (edges.length >= DIAGRAM_MAX_EDGES) return;
        // Is this pair already joined, whichever way the existing edge points? With API -> DB on the canvas:
        //   left half, same direction:      dragging API -> DB again (same start, same end)
        //   right half, opposite direction: dragging DB -> API (it starts where the existing edge ends,
        //                                   and ends where it starts)
        // Either one is a duplicate under rule 3.
        const duplicate = edges.some(
            (e) => (e.source === source && e.target === target) || (e.source === target && e.target === source),
        );
        if (duplicate) return;
        const edge: DiagramFlowEdge = {
            id: crypto.randomUUID(),
            source,
            target,
            data: { label: "", bidirectional: false },
        };
        snapshot();
        setEdges((current) => [...current, edge]);
    }

    // ── What React Flow draws for each edge ─────────────────────────────────────────────────────
    // The stored edge is just source/target + data; for drawing:
    // 1. Attach it to the sides of its two nodes that face each other (facingHandles), so it
    //    re-routes as the nodes move.
    // 2. Show its label (if it has one).
    // 3. An arrowhead at the target, and at the source too when it's two-way.
    const drawnEdges = useMemo(() => {
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        return edges.map((edge) => {
            const source = nodeById.get(edge.source);
            const target = nodeById.get(edge.target);
            const [sourceHandle, targetHandle] = source && target ? facingHandles(source, target) : [null, null];
            return {
                ...edge,
                type: "smoothstep",
                sourceHandle,
                targetHandle,
                label: edge.data?.label.trim() || undefined,
                markerEnd: ARROW,
                markerStart: edge.data?.bidirectional ? ARROW : undefined,
            };
        });
    }, [nodes, edges]);

    // ── Inline rename (double-click) ────────────────────────────────────────────────────────────
    const editing: DiagramEditing = {
        editingId,
        commitRename: (id, label) => {
            // a blur with the name unchanged isn't an edit, so it's not an undo step
            const renamed = nodes.find((node) => node.id === id);
            if (renamed && renamed.data.label !== label) snapshot();
            updateNodeData(id, { label });
            setEditingId(null);
        },
        cancelRename: () => setEditingId(null),
    };

    // ── Inspector: exactly one node OR one edge selected ────────────────────────────────────────
    const selectedNodes = nodes.filter((node) => node.selected);
    const selectedEdges = edges.filter((edge) => edge.selected);
    let inspector = null;
    if (!readOnly && selectedNodes.length === 1 && selectedEdges.length === 0) {
        const node = selectedNodes[0];
        inspector = (
            <NodeInspector
                data={node.data}
                onChange={(patch) => {
                    snapshotEdit(`${node.id}:${Object.keys(patch).join()}`);
                    updateNodeData(node.id, patch);
                }}
                onDelete={() => deleteElements({ nodes: [{ id: node.id }] })}
            />
        );
    } else if (!readOnly && selectedEdges.length === 1 && selectedNodes.length === 0) {
        const edge = selectedEdges[0];
        inspector = (
            <EdgeInspector
                data={edge.data ?? { label: "", bidirectional: false }}
                onChange={(patch) => {
                    snapshotEdit(`${edge.id}:${Object.keys(patch).join()}`);
                    updateEdgeData(edge.id, patch);
                }}
                onDelete={() => deleteElements({ edges: [{ id: edge.id }] })}
            />
        );
    }

    return (
        <div className="flex min-h-0 flex-1 gap-3">
            {!readOnly && <DiagramPalette disabled={nodes.length >= DIAGRAM_MAX_NODES} onAdd={handleAdd} />}
            <div ref={wrapperRef} className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-divider">
                <DiagramEditingContext.Provider value={editing}>
                    <ReactFlow
                        className="diagram-flow"
                        colorMode="dark"
                        nodes={nodes}
                        edges={drawnEdges}
                        nodeTypes={NODE_TYPES}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={handleConnect}
                        // undo steps: a delete (Delete key or the inspector's Trash, plus any edges it
                        // takes with it) and a whole drag are one step each
                        onBeforeDelete={async () => {
                            snapshot();
                            return true;
                        }}
                        onNodeDragStart={snapshot}
                        onSelectionDragStart={snapshot}
                        isValidConnection={(connection) => connection.source !== connection.target}
                        // Loose: every handle is a "source", and any can end a connection too.
                        connectionMode={ConnectionMode.Loose}
                        onNodeDoubleClick={(_, node) => !readOnly && setEditingId(node.id)}
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        snapToGrid
                        snapGrid={[DIAGRAM_GRID, DIAGRAM_GRID]}
                        deleteKeyCode={readOnly ? null : ["Delete", "Backspace"]}
                        nodesDraggable={!readOnly}
                        nodesConnectable={!readOnly}
                        elementsSelectable={!readOnly}
                        /* left click select, right click pan canvas */
                        selectionMode={SelectionMode.Partial}
                        panOnDrag={[2]}
                        selectionOnDrag={true}
                        // a resumed diagram opens framed; a blank one stays at 100%
                        fitView={initial.nodes.length > 0}
                        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                        minZoom={0.25}
                        maxZoom={2}
                    >
                        <Background variant={BackgroundVariant.Dots} gap={DIAGRAM_GRID} size={1} />
                        <Controls showInteractive={false} />
                        {!readOnly && (
                            <Controls
                                position="top-left"
                                orientation="horizontal"
                                showZoom={false}
                                showFitView={false}
                                showInteractive={false}
                            >
                                <ControlButton onClick={handleUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
                                    <ArrowCounterClockwise />
                                </ControlButton>
                                <ControlButton onClick={handleRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
                                    <ArrowClockwise />
                                </ControlButton>
                            </Controls>
                        )}
                        {inspector && <Panel position="top-right">{inspector}</Panel>}
                    </ReactFlow>
                </DiagramEditingContext.Provider>

                {nodes.length === 0 && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-[13px] leading-[1.6] text-neutral-500">
                        {readOnly ? (
                            "No diagram was drawn."
                        ) : (
                            <span>
                                Drag components from the left to start your design.
                                <br />
                                Connect them by dragging between the dots on their edges.
                                <br />
                                Double-click to rename. Delete removes what's selected.
                                <br />
                                Ctrl+C / Ctrl+V copies what's selected. Ctrl+Z undoes.
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
