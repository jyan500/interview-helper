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
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
    Background,
    BackgroundVariant,
    ConnectionMode,
    Controls,
    MarkerType,
    Panel,
    ReactFlow,
    useEdgesState,
    useNodesState,
    useReactFlow,
    type Connection,
    type EdgeMarker,
    type NodeTypes,
    type XYPosition,
} from "@xyflow/react";
import type { DiagramDoc, DiagramNodeKind } from "../../api";
import { DIAGRAM_DRAG_MIME, DIAGRAM_GRID, DIAGRAM_MAX_EDGES, DIAGRAM_MAX_NODES } from "../../constants";
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
        setNodes((current) => [...current.map((n) => ({ ...n, selected: false })), node]);
        setEdges((current) => current.map((e) => ({ ...e, selected: false })));
        if (kind === "text") setEditingId(id);
    }

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
    const handleConnect = useCallback(
        (connection: Connection) => {
            const { source, target } = connection;
            if (source === target) return;
            setEdges((current) => {
                if (current.length >= DIAGRAM_MAX_EDGES) return current;
                const duplicate = current.some(
                    (e) => (e.source === source && e.target === target) || (e.source === target && e.target === source),
                );
                if (duplicate) return current;
                const edge: DiagramFlowEdge = {
                    id: crypto.randomUUID(),
                    source,
                    target,
                    data: { label: "", bidirectional: false },
                };
                return [...current, edge];
            });
        },
        [setEdges],
    );

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
                onChange={(patch) => updateNodeData(node.id, patch)}
                onDelete={() => deleteElements({ nodes: [{ id: node.id }] })}
            />
        );
    } else if (!readOnly && selectedEdges.length === 1 && selectedNodes.length === 0) {
        const edge = selectedEdges[0];
        inspector = (
            <EdgeInspector
                data={edge.data ?? { label: "", bidirectional: false }}
                onChange={(patch) => updateEdgeData(edge.id, patch)}
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
                        selectionMode="partial" 
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
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
