/**
 * The "Need help?" trigger beside a workspace's heading. It only opens the tour; the panel owns the
 * `touring` flag and mounts GuidedTour while it's set.
 */
import { Question } from "@phosphor-icons/react";
import Button from "../Button";

export default function NeedHelpButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
    return (
        <Button variant="ghost" className="flex items-center gap-1.5 text-[12.5px]" onClick={onClick} disabled={disabled}>
            <Question size={14} />
            Need help?
        </Button>
    );
}
