/**
 * The sticky "you've changed your selection" bar for the QuestionsTable curation flow. Renders only
 * when there are unsaved changes (`dirty`), showing the running count of selected questions plus
 * Reset and Save. Shared by the dashboard "My questions" section, the Add-question modal, and the
 * Questions page — a dumb presentational strip; the staging + Save live in useQuestionSelection.
 *
 * Sticky to the bottom of its scroll container so it stays reachable while paging through a long
 * list. Its own visibility is toggled with the `hidden` attribute (never display) per the app rule.
 */
import Button from "./Button";

export default function SelectionBar({
    count,
    dirty,
    saving,
    onSave,
    onReset,
}: {
    count: number;
    dirty: boolean;
    saving: boolean;
    onSave: () => void;
    onReset: () => void;
}) {
    return (
        <div
            hidden={!dirty}
            className="sticky bottom-0 mt-3 flex items-center justify-between gap-3 rounded-md border border-divider bg-bg px-4 py-3"
        >
            <span className="text-[13.5px] text-neutral-300">
                <strong className="text-ink">{count}</strong>{" "}
                {count === 1 ? "question" : "questions"} selected
            </span>
            <div className="flex items-center gap-2.5">
                <Button variant="ghost" className="text-[13px]" onClick={onReset} disabled={saving}>
                    Reset
                </Button>
                <Button
                    variant="primary"
                    className="text-[13px] disabled:opacity-50"
                    onClick={onSave}
                    disabled={saving}
                >
                    {saving ? "Saving…" : "Save"}
                </Button>
            </div>
        </div>
    );
}
