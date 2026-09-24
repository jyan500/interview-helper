/**
 * One round format on a Job page (behavioral · coding · system design) with its Start button. Starting
 * GENERATES that company's round (questions + grading briefs) before the session opens, so the page
 * shows a blocking overlay meanwhile — this card just fires `onStart`.
 *
 * A round that needs the code editor (`has_code_editor`) is shown but not startable until the editor
 * ships; `unavailable` carries that, so the card doesn't branch on a slug.
 */
import type { RoundTypeItem } from "../api";
import { Skeleton } from "./Skeleton";
import Button from "./Button";

export default function RoundCard({
    round,
    disabled,
    unavailable = false,
    onStart,
}: {
    round: RoundTypeItem;
    disabled: boolean;
    unavailable?: boolean;
    onStart: () => void;
}) {
    return (
        <div className="flex flex-col gap-3 rounded-md border border-divider px-[18px] pb-4 pt-[15px]">
            <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-heading text-[19px] font-medium">{round.name}</h3>
                {unavailable && <span className="tag tag-neutral whitespace-nowrap">Coming soon</span>}
            </div>
            <p className="flex-1 text-[13.5px] leading-[1.45] text-neutral-400 [text-wrap:pretty]">
                {round.description}
            </p>
            <Button
                variant="primary"
                className="self-start text-[13.5px] disabled:opacity-50"
                disabled={disabled || unavailable}
                onClick={onStart}
            >
                Start round
            </Button>
        </div>
    );
}

// The loading placeholder in the same shape: title, two lines of description, the button.
export function RoundCardSkeleton() {
    return (
        <div className="flex flex-col gap-3 rounded-md border border-divider px-[18px] pb-4 pt-[15px]">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="mt-1 h-8 w-24" />
        </div>
    );
}
