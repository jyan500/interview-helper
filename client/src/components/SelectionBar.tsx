/**
 * The sticky bulk-action bar for the QuestionsTable curation flow. Renders only when rows are selected
 * (`count` > 0), showing how many plus Clear and the current action ("Add to saved" / "Remove from
 * saved"). Used by the Questions page — a dumb presentational strip; the selection + the action live in
 * useQuestionSelection.
 *
 * Sticky to the bottom of its scroll container so it stays reachable while paging through a long
 * list. Its own visibility is toggled with the `hidden` attribute (never display) per the app rule.
 */
import Button from "./Button";

export default function SelectionBar({
    count,
    actionLabel,
    busyLabel,
    busy,
    onAction,
    onClear,
}: {
    count: number;
    actionLabel: string;
    busyLabel: string;
    busy: boolean;
    onAction: () => void;
    onClear: () => void;
}) {
    return (
        <div
            hidden={count === 0}
            className="sticky bottom-4 mt-3 flex items-center justify-between gap-3 rounded-md bg-surface px-4 py-3 shadow-lg"
        >
            <span className="text-[13.5px] text-neutral-300">
                <strong className="text-ink">{count}</strong> selected
            </span>
            <div className="flex items-center gap-2.5">
                <Button variant="ghost" className="text-[13px]" onClick={onClear} disabled={busy}>
                    Clear
                </Button>
                <Button
                    variant="primary"
                    className="text-[13px] disabled:opacity-50"
                    onClick={onAction}
                    disabled={busy}
                >
                    {busy ? busyLabel : actionLabel}
                </Button>
            </div>
        </div>
    );
}
