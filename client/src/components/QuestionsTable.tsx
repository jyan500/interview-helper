/**
 * The question-bank table — shared by the dashboard "My questions" section, the Add-question modal,
 * and the standalone Questions page. Modelled on InterviewsTable (same `.table` chrome, same
 * shape-matching shimmer while `loading`), with ONE addition: a leading checkbox column for
 * curating the saved "My questions" set.
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
    isChecked: (slug: string, serverSelected: boolean) => boolean;
    onToggle: (slug: string, serverSelected: boolean) => void;
    loading?: boolean;
    skeletonRows?: number;
    emptyMessage?: string;
}) {
    // Empty line only when settled with no rows — never mid-fetch, when the skeleton shows.
    if (!loading && questions.length === 0) {
        return <p className="px-3 py-6 text-[13.5px] text-neutral-400">{emptyMessage}</p>;
    }

    return (
        <div className="overflow-x-auto">
            <table className="table">
                <thead>
                    <tr>
                        {/* narrow checkbox column; the header is intentionally blank (per-row control) */}
                        <th className="w-8"></th>
                        <th>Question</th>
                        <th>Type</th>
                        <th>Level</th>
                    </tr>
                </thead>
                <tbody>
                    {loading &&
                        Array.from({ length: skeletonRows }).map((_, i) => (
                            <tr key={i}>
                                <td><Skeleton inline className="h-3.5 w-3.5" /></td>
                                <td><Skeleton inline className="h-3.5 w-72" /></td>
                                <td><Skeleton inline className="h-3.5 w-24" /></td>
                                <td><Skeleton inline className="h-3.5 w-16" /></td>
                            </tr>
                        ))}
                    {!loading &&
                        questions.map((q) => {
                            const checked = isChecked(q.slug, q.selected);
                            return (
                                <tr key={q.slug}>
                                    <td>
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 cursor-pointer accent-accent"
                                            checked={checked}
                                            onChange={() => onToggle(q.slug, q.selected)}
                                            aria-label={`Select "${q.text}"`}
                                        />
                                    </td>
                                    {/* the question text is the row's substance — let it wrap, unlike
                                        the terse cells beside it. Clicking it also toggles the row, so
                                        the whole line is a target, not just the 16px box. */}
                                    <td
                                        className="max-w-[560px] cursor-pointer align-top"
                                        onClick={() => onToggle(q.slug, q.selected)}
                                    >
                                        {q.text}
                                    </td>
                                    <td className="whitespace-nowrap align-top text-neutral-300">
                                        {q.type_name}
                                    </td>
                                    <td className="whitespace-nowrap align-top text-neutral-400">
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
