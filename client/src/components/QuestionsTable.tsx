/**
 * The question-bank table — the Questions page's Saved and Other sections, and the dashboard's
 * read-only "Your question bank" preview. Modelled on InterviewsTable (same `.table` chrome, same
 * shape-matching shimmer while `loading`), with ONE addition: a leading checkbox column for
 * curating the saved "My questions" set. Selection is OPTIONAL — omit `isChecked`/`onToggle` and the
 * checkbox column is dropped, leaving a plain read-only list.
 *
 * PURE PRESENTATION, exactly like InterviewsTable: the caller owns the fetch and the selection
 * state. A row's checked state is NOT its raw server `selected` flag — the caller (via
 * useQuestionSelection) may have staged an unsaved toggle — so we ask through `isChecked(slug,
 * serverSelected)` and report clicks back through `onToggle(slug, serverSelected)`. Whether a click
 * saves immediately or stages until a Save button is the caller's business.
 */
import type { QuestionItem } from "../api";
import { Skeleton } from "./Skeleton";

export default function QuestionsTable({
    questions,
    isChecked,
    onToggle,
    loading = false,
    skeletonRows = 8,
    emptyMessage = "No questions here yet.",
}: {
    questions: QuestionItem[];
    isChecked?: (slug: string, serverSelected: boolean) => boolean;
    onToggle?: (slug: string, serverSelected: boolean) => void;
    loading?: boolean;
    skeletonRows?: number;
    emptyMessage?: string;
}) {
    const selectable = Boolean(isChecked && onToggle);

    // Empty line only when settled with no rows — never mid-fetch, when the skeleton shows.
    if (!loading && questions.length === 0) {
        return <p className="px-3 py-6 text-[13.5px] text-neutral-400">{emptyMessage}</p>;
    }

    return (
        <div className="overflow-x-auto">
            {/* table-fixed + a colgroup pins the column widths so they don't depend on cell content —
                without it the narrow loading skeletons size the columns smaller than real rows and the
                headers "jump" when data arrives. Question (the wide column) takes the remainder; the
                rest are fixed. */}
            <table className="table table-fixed min-w-[640px]">
                <colgroup>
                    {selectable && <col className="w-10" />}
                    <col />
                    <col className="w-36" />
                    <col className="w-24" />
                </colgroup>
                <thead>
                    <tr>
                        {/* narrow checkbox column; the header is intentionally blank (per-row control) */}
                        {selectable && <th></th>}
                        <th>Question</th>
                        <th>Type</th>
                        <th>Level</th>
                    </tr>
                </thead>
                <tbody>
                    {loading &&
                        Array.from({ length: skeletonRows }).map((_, i) => (
                            <tr key={i}>
                                {selectable && <td><Skeleton inline className="h-3.5 w-3.5" /></td>}
                                <td><Skeleton inline className="h-3.5 w-72" /></td>
                                <td><Skeleton inline className="h-3.5 w-24" /></td>
                                <td><Skeleton inline className="h-3.5 w-16" /></td>
                            </tr>
                        ))}
                    {!loading &&
                        questions.map((q) => {
                            const toggle = () => onToggle?.(q.slug, q.selected);
                            return (
                                <tr key={q.slug}>
                                    {selectable && (
                                        <td>
                                            <input
                                                type="checkbox"
                                                className="h-4 w-4 cursor-pointer accent-accent"
                                                checked={isChecked!(q.slug, q.selected)}
                                                onChange={toggle}
                                                aria-label={`Select "${q.text}"`}
                                            />
                                        </td>
                                    )}
                                    {/* the question is the row's substance, but questions get long — so
                                        clamp to 2 lines for a uniform, scannable row height and expose the
                                        full text on hover (title). When selectable, clicking anywhere on it
                                        also toggles the row, so the whole line is a target, not just the
                                        16px box. */}
                                    <td
                                        className={selectable ? "cursor-pointer align-top" : "align-top"}
                                        onClick={selectable ? toggle : undefined}
                                    >
                                        <div className="line-clamp-2" title={q.text}>{q.text}</div>
                                    </td>
                                    <td className="truncate align-top text-neutral-300" title={q.type_name}>
                                        {q.type_name}
                                    </td>
                                    <td className="truncate align-top text-neutral-400" title={q.level_name ?? undefined}>
                                        {q.level_name ?? "—"}
                                    </td>
                                </tr>
                            );
                        })}
                </tbody>
            </table>
        </div>
    );
}
