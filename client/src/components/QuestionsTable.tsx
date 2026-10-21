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
 *
 * The candidate's OWN questions (`is_custom`) carry a "Custom" tag. Pass `onEdit`/`onDelete` and those
 * rows also get Edit / Delete icon buttons in a trailing actions column. A question saved from a job
 * interview (`is_claimed`) is tagged "From interview" and gets View (`onView`) instead of Edit: its
 * interview still reads it, so editing it would rewrite that interview's history. Bank rows get View
 * only (they aren't the candidate's to edit or delete); View is how the full text is read, since the
 * row truncates it. In a table with `onView` but no `onEdit`/`onDelete`, every row gets View.
 */
import { Eye, PencilSimple, Trash } from "@phosphor-icons/react";
import type { QuestionItem } from "../api";
import Button from "./Button";
import { Skeleton } from "./Skeleton";

export default function QuestionsTable({
    questions,
    isChecked,
    onToggle,
    onEdit,
    onView,
    onDelete,
    loading = false,
    skeletonRows = 8,
    emptyMessage = "No questions here yet.",
}: {
    questions: QuestionItem[];
    isChecked?: (slug: string, serverSelected: boolean) => boolean;
    onToggle?: (slug: string, serverSelected: boolean) => void;
    onEdit?: (question: QuestionItem) => void;
    onView?: (question: QuestionItem) => void;
    onDelete?: (question: QuestionItem) => void;
    loading?: boolean;
    skeletonRows?: number;
    emptyMessage?: string;
}) {
    const selectable = Boolean(isChecked && onToggle);
    const editable = Boolean(onEdit && onDelete);
    // the trailing actions column: Edit/Delete for your own rows, View for bank and claimed rows
    const hasActions = editable || Boolean(onView);
    // Edit is only for your own questions, and not ones saved from an interview (those are read-only)
    const canEdit = (q: QuestionItem) => editable && q.is_custom && !q.is_claimed;

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
                    {hasActions && <col className="w-24" />}
                </colgroup>
                <thead>
                    <tr>
                        {/* narrow checkbox column; the header is intentionally blank (per-row control) */}
                        {selectable && <th></th>}
                        <th>Question</th>
                        <th>Type</th>
                        <th>Level</th>
                        {hasActions && <th></th>}
                    </tr>
                </thead>
                <tbody>
                    {loading &&
                        Array.from({ length: skeletonRows }).map((_, i) => (
                            <tr key={i}>
                                {selectable && <td><Skeleton inline className="h-3.5 w-3.5" /></td>}
                                {/* two bars: the title, then the shorter-looking text preview line */}
                                <td>
                                    <Skeleton className="h-3.5 w-48" />
                                    <Skeleton className="mt-1.5 h-3 w-72" />
                                </td>
                                <td><Skeleton inline className="h-3.5 w-24" /></td>
                                <td><Skeleton inline className="h-3.5 w-16" /></td>
                                {hasActions && <td></td>}
                            </tr>
                        ))}
                    {!loading &&
                        questions.map((q) => {
                            const toggle = () => onToggle?.(q.slug, q.selected);
                            return (
                                <tr key={q.slug}>
                                    {selectable && (
                                        <td className="align-middle">
                                            <input
                                                type="checkbox"
                                                className="h-4 w-4 cursor-pointer accent-accent"
                                                checked={isChecked!(q.slug, q.selected)}
                                                onChange={toggle}
                                                aria-label={`Select "${q.title}"`}
                                            />
                                        </td>
                                    )}
                                    {/* the row leads with the question's short title; the full text (which
                                        gets long) follows as a muted one-line preview; View opens all of it.
                                        When selectable, clicking anywhere on it also toggles the row, so the
                                        whole cell is a target, not just the 16px box. */}
                                    <td
                                        className={selectable ? "cursor-pointer align-middle" : "align-middle"}
                                        onClick={selectable ? toggle : undefined}
                                    >
                                        <div className="truncate font-medium text-ink">
                                            {q.is_custom && (
                                                <span className="tag tag-accent mr-2 align-middle">
                                                    {q.is_claimed ? "From interview" : "Custom"}
                                                </span>
                                            )}
                                            {q.title}
                                        </div>
                                        <div className="mt-0.5 truncate text-[12.5px] text-neutral-400">
                                            {q.text}
                                        </div>
                                    </td>
                                    <td className="truncate align-middle text-neutral-300" title={q.type_name}>
                                        {q.type_name}
                                    </td>
                                    <td className="truncate align-middle text-neutral-400" title={q.level_name ?? undefined}>
                                        {q.level_name ?? "—"}
                                    </td>
                                    {hasActions && (
                                        <td className="align-middle">
                                            <div className="flex justify-end gap-1">
                                                {/* View on any row without Edit: bank and claimed rows, and every
                                                    row of a non-editable table */}
                                                {onView && !canEdit(q) && (
                                                    <Button variant="ghost" icon aria-label={`View "${q.title}"`} title="View" onClick={() => onView(q)}>
                                                        <Eye size={17} weight="regular" />
                                                    </Button>
                                                )}
                                                {canEdit(q) && (
                                                    <Button variant="ghost" icon aria-label={`Edit "${q.title}"`} title="Edit" onClick={() => onEdit!(q)}>
                                                        <PencilSimple size={17} weight="regular" />
                                                    </Button>
                                                )}
                                                {editable && q.is_custom && (
                                                    <Button variant="ghost" icon aria-label={`Delete "${q.title}"`} title="Delete" onClick={() => onDelete!(q)}>
                                                        <Trash size={17} weight="regular" />
                                                    </Button>
                                                )}
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                </tbody>
            </table>
        </div>
    );
}
