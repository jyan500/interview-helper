/**
 * The past-interviews table — shared by the Dashboard's "Past interviews" card and the
 * standalone Interviews page. One component so the two stay identical: same columns, same
 * row affordances, same navigation.
 *
 * COLUMNS: Interview (role · level), Date, Score, and a trailing action. The action is
 * "Resume" ONLY on the single resumable interview (the most-recent unfinished one, matched by
 * `resumableId`) — resuming a stale interview 409s server-side, so we don't offer it — and
 * "Open" (→ the detail view) on every other row.
 *
 * PURE PRESENTATION: the caller owns the fetch and hands in the rows it wants shown (the
 * Dashboard slices to a few recent ones; the Interviews page passes the full list) plus the
 * resumable id. Error state lives with the caller too, since their surrounding chrome differs;
 * this renders the table, a short empty line when there are no rows, or — while `loading` — a
 * shimmer skeleton in the same shape, so a re-fetch (page/filter change) doesn't flash stale rows.
 */
import { useNavigate } from "react-router";
import type { InterviewSummary } from "../api";
import { formatShortDate, formatScore } from "../helpers";
import { PAGE_SIZE } from "../constants"
import { SkeletonRow } from "./SkeletonRow"


export default function InterviewsTable({
    interviews,
    resumableId = null,
    loading = false,
    skeletonRows = 8,
}: {
    interviews: InterviewSummary[];
    resumableId?: string | null;
    loading?: boolean;
    skeletonRows?: number;
}) {
    const navigate = useNavigate();

    // Redraw an in-progress interview: hand /session the same route state the resume banner does
    // (role/level are the human-readable names for the header; `resume: true`, no firstMessage, so
    // SessionPage hydrates from the transcript rather than seeding a first question).
    function onResume(iv: InterviewSummary) {
        navigate("/session", {
            state: {
                interviewId: iv.interview_id,
                role: iv.role,
                level: iv.level,
                resume: true,
            },
        });
    }

    // Empty line only when we're settled with no rows — never mid-fetch, when the skeleton shows.
    if (!loading && interviews.length === 0) {
        return (
            <p className="px-3 py-6 text-[13.5px] text-neutral-400">
                No interviews yet — finish one and it'll show up here.
            </p>
        );
    }

    return (
        <div className="overflow-x-auto">
            <table className="table">
                <thead>
                    <tr>
                        <th>Interview</th>
                        <th>Date</th>
                        <th>Score</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {loading && Array.from({ length: skeletonRows }).map((_, i) => <SkeletonRow key={i} />)}
                    {!loading && interviews.map((iv) => {
                        const isResumable = iv.interview_id === resumableId;
                        return (
                            <tr key={iv.interview_id}>
                                <td className="whitespace-nowrap">
                                    {iv.role} <span className="text-neutral-400">· {iv.level}</span>
                                </td>
                                <td className="whitespace-nowrap text-neutral-300">
                                    {formatShortDate(iv.created_at)}
                                </td>
                                <td>
                                    {iv.overall !== null ? (
                                        <span>
                                            <strong>{formatScore(iv.overall)}</strong>
                                            <span className="text-[13px] text-neutral-400">/5</span>
                                        </span>
                                    ) : (
                                        <span className="text-neutral-400">—</span>
                                    )}
                                </td>
                                <td className="text-right">
                                    {isResumable ? (
                                        <button
                                            className="btn btn-primary text-[13px]"
                                            onClick={() => onResume(iv)}
                                        >
                                            Resume
                                        </button>
                                    ) : (
                                        <button
                                            className="btn btn-ghost text-[13px]"
                                            onClick={() => navigate(`/interviews/${iv.interview_id}`)}
                                        >
                                            Open
                                        </button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
