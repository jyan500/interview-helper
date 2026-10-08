/**
 * The floating editor frame in the canvas's top-right corner, shown while exactly one node or edge is
 * selected. A shell: NodeInspector / EdgeInspector supply the fields as children.
 */
import type { ReactNode } from "react";
import { Trash } from "@phosphor-icons/react";
import Button from "../Button";

export default function DiagramInspector({
    title,
    onDelete,
    children,
}: {
    title: string;
    onDelete: () => void;
    children: ReactNode;
}) {
    return (
        // nowheel: scrolling inside the editor mustn't zoom the canvas
        <div className="nowheel flex w-[230px] flex-col gap-2.5 rounded-md border border-divider bg-surface p-3 shadow-md">
            <div className="flex items-center justify-between">
                <span className="kicker">{title}</span>
                <Button variant="ghost" icon aria-label="Delete" className="h-7 w-7" onClick={onDelete}>
                    <Trash size={15} weight="regular" />
                </Button>
            </div>
            {children}
        </div>
    );
}
