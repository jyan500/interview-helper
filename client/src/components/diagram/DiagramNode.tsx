/**
 * The canvas's one custom node type. It draws a component by its palette kind: a cylinder for a
 * database, a circle, a plain box, a free-floating note for text, and a rounded card with the kind's
 * icon for everything else. Handles sit on all 4 sides; the canvas runs in ConnectionMode.Loose, so any
 * handle can start or end a connection, and DiagramPanel picks the facing sides when it draws an edge.
 *
 * A double-click (handled by DiagramPanel) swaps the label for an input; Enter or blur keeps it, Esc
 * drops it.
 */
import { useContext, useEffect, useRef } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Note } from "@phosphor-icons/react";
import { DIAGRAM_MAX_LABEL_CHARS } from "../../constants";
import { diagramKindInfo, type DiagramFlowNode } from "../../helpers";
import { DiagramEditingContext } from "./DiagramEditingContext";

const HANDLE_SIDES = [
    { id: "top", position: Position.Top },
    { id: "right", position: Position.Right },
    { id: "bottom", position: Position.Bottom },
    { id: "left", position: Position.Left },
];

export default function DiagramNode({ id, data, selected }: NodeProps<DiagramFlowNode>) {
    const { editingId, commitRename, cancelRename } = useContext(DiagramEditingContext);
    const info = diagramKindInfo(data.kind);
    const KindIcon = info.icon;
    const name = data.label.trim();
    const editing = editingId === id;
    // Set by Esc for the current rename only; a new rename starts clear.
    const cancelledRef = useRef(false);
    useEffect(() => {
        if (editing) cancelledRef.current = false;
    }, [editing]);

    // An unnamed component shows its kind, muted (the LLMs read it as "(unnamed cache)").
    const label =
        editing ? (
            <input
                autoFocus
                defaultValue={data.label}
                maxLength={DIAGRAM_MAX_LABEL_CHARS}
                onFocus={(e) => e.target.select()}
                // Esc unmounts the input, which blurs it: the flag stops that blur from committing.
                onBlur={(e) => {
                    if (!cancelledRef.current) commitRename(id, e.target.value);
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(id, e.currentTarget.value);
                    if (e.key === "Escape") {
                        cancelledRef.current = true;
                        cancelRename();
                    }
                }}
                // nodrag/nopan: selecting text in the input mustn't drag the node or pan the canvas
                className="nodrag nopan w-full min-w-0 rounded-sm border border-accent bg-bg px-1 text-[13px] text-ink outline-none"
            />
        ) : (
            <span className={"min-w-0 break-words " + (name ? "" : "text-neutral-500")}>
                {name || (data.kind === "text" ? "Double-click to write" : info.label)}
            </span>
        );

    const border = selected ? "border-accent shadow-[0_0_0_1px_var(--color-accent)]" : "border-neutral-600";

    let body;
    if (info.shape === "text") {
        // A note: no box, no handles (nothing connects to it).
        body = (
            <div
                className={
                    "max-w-[220px] rounded-sm border border-dashed px-1.5 py-0.5 text-[13px] text-neutral-300 " +
                    (selected ? "border-accent" : "border-transparent")
                }
            >
                {label}
            </div>
        );
    } else if (info.shape === "circle") {
        body = (
            <div
                className={
                    "flex h-[96px] w-[96px] flex-col items-center justify-center gap-1 rounded-full border bg-surface p-2 text-center text-[13px] " +
                    border
                }
            >
                {label}
            </div>
        );
    } else if (info.shape === "cylinder") {
        // Elliptical top and bottom (border-radius 50% / 12px), plus the near rim of the lid.
        body = (
            <div
                className={
                    "relative flex min-w-[120px] max-w-[200px] items-center gap-2 border bg-surface px-3 pb-2.5 pt-6 text-[13px] " +
                    border
                }
                style={{ borderRadius: "50% / 12px" }}
            >
                <div
                    className={"pointer-events-none absolute inset-x-0 top-0 h-[24px] rounded-[50%] border-b " + border}
                />
                <KindIcon size={15} className="flex-none text-accent-300" />
                {label}
            </div>
        );
    } else {
        body = (
            <div
                className={
                    "flex min-w-[120px] max-w-[200px] items-center gap-2 border bg-surface px-3 py-2 text-[13px] " +
                    border +
                    (info.shape === "rounded" ? " rounded-md" : "")
                }
            >
                <KindIcon size={15} className="flex-none text-accent-300" />
                {label}
            </div>
        );
    }

    return (
        <div className="relative" title={data.notes || undefined}>
            {body}
            {/* Notes aren't drawn on the canvas (they'd crowd it); a mark says there are some. */}
            {data.notes.trim() && info.shape !== "text" && (
                <Note size={12} weight="fill" className="absolute -right-1.5 -top-1.5 text-accent-300" />
            )}
            {info.shape !== "text" &&
                HANDLE_SIDES.map((side) => (
                    <Handle key={side.id} id={side.id} type="source" position={side.position} className="diagram-handle" />
                ))}
        </div>
    );
}
