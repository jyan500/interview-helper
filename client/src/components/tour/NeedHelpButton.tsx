/**
 * The trigger for a tour: "Need help?" beside a workspace's heading, or another label where two tours
 * share a page (the session header's "How it works"). It only opens the tour; the owner keeps the
 * `touring` flag and mounts GuidedTour while it's set.
 */
import { Question } from "@phosphor-icons/react";
import Button from "../Button";

export default function NeedHelpButton({
    onClick,
    disabled,
    label = "Need help?",
}: {
    onClick: () => void;
    disabled: boolean;
    label?: string;
}) {
    return (
        <Button variant="ghost" className="flex items-center gap-1.5 text-[12.5px]" onClick={onClick} disabled={disabled}>
            <Question size={14} />
            {label}
        </Button>
    );
}
