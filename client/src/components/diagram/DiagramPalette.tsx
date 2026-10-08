/**
 * The component palette beside the canvas. Drag an item onto the canvas to drop it there (DiagramPanel
 * reads DIAGRAM_DRAG_MIME on drop), or click it to add one in the middle of the view.
 */
import type { DiagramNodeKind } from "../../api";
import { DIAGRAM_DRAG_MIME, DIAGRAM_NODE_KINDS } from "../../constants";

export default function DiagramPalette({
    disabled,
    onAdd,
}: {
    disabled: boolean; // read-only, or the diagram is at the node cap
    onAdd: (kind: DiagramNodeKind) => void;
}) {
    return (
        <div className="flex min-h-0 w-[132px] flex-none flex-col gap-1 overflow-y-auto pr-1">
            {DIAGRAM_NODE_KINDS.map((item) => {
                const KindIcon = item.icon;
                return (
                    <button
                        key={item.kind}
                        type="button"
                        draggable={!disabled}
                        disabled={disabled}
                        onDragStart={(e) => {
                            e.dataTransfer.setData(DIAGRAM_DRAG_MIME, item.kind);
                            e.dataTransfer.effectAllowed = "move";
                        }}
                        onClick={() => onAdd(item.kind)}
                        className="flex cursor-grab items-center gap-2 rounded-md border border-divider px-2 py-1.5 text-left text-[12.5px] text-neutral-200 hover:border-neutral-500 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                        <KindIcon size={15} className="flex-none text-accent-300" />
                        {item.label}
                    </button>
                );
            })}
        </div>
    );
}
