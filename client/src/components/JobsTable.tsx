/**
 * The saved-jobs table on the Jobs page. PURE PRESENTATION, like InterviewsTable: the page owns the
 * fetch (paged + searched server-side) and hands in the rows; this renders them, a short empty line,
 * or — while `loading` — the shared four-column shimmer skeleton so a refetch never flashes stale rows.
 */
import { useNavigate } from "react-router";
import type { JobItem } from "../api";
import { formatShortDate } from "../helpers";
import { SkeletonRow } from "./SkeletonRow";
import Button from "./Button";

export default function JobsTable({
    jobs,
    loading = false,
    skeletonRows = 8,
    emptyMessage,
}: {
    jobs: JobItem[];
    loading?: boolean;
    skeletonRows?: number;
    emptyMessage: string;
}) {
    const navigate = useNavigate();

    if (!loading && jobs.length === 0) {
        return <p className="px-3 py-6 text-[13.5px] text-neutral-400">{emptyMessage}</p>;
    }

    return (
        <div className="overflow-x-auto">
            {/* table-fixed + colgroup pins the widths so the skeleton and the real rows line up */}
            <table className="table table-fixed min-w-[640px]">
                <colgroup>
                    <col />
                    <col className="w-64" />
                    <col className="w-28" />
                    <col className="w-24" />
                </colgroup>
                <thead>
                    <tr>
                        <th>Job</th>
                        <th>Role</th>
                        <th>Added</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {loading && Array.from({ length: skeletonRows }).map((_, i) => <SkeletonRow key={i} />)}
                    {!loading && jobs.map((job) => (
                        <tr key={job.job_id}>
                            <td className="truncate">
                                {job.company} <span className="text-neutral-400">· {job.title}</span>
                            </td>
                            <td className="truncate text-neutral-300">
                                {job.role_name} · {job.level_name}
                            </td>
                            <td className="whitespace-nowrap text-neutral-300">{formatShortDate(job.created_at)}</td>
                            <td className="text-right">
                                <Button
                                    variant="ghost"
                                    className="text-[13px]"
                                    onClick={() => navigate(`/jobs/${job.job_id}`)}
                                >
                                    Open
                                </Button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
