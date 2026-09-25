/**
 * One saved job — where a company's interview rounds are started and reviewed.
 *
 *   - Round cards (GET /api/round-types): Start GENERATES that company's round, then opens /session
 *     through the shared start sequence (overwrite confirm → POST /api/interview {job, round}). The
 *     generation takes several seconds, so the blocking overlay says what it's doing.
 *   - Simulations: this job's interviews (GET /api/interviews?job=), the shared InterviewsTable.
 *   - Details: the edit form (JobEditCard), plus the extractor's summary and the raw posting.
 *   - Delete: confirm, then DELETE (the backend cascades the job's simulations) and back to /jobs.
 */
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
    useDeleteJobMutation,
    useGetJobQuery,
    useGetMyInterviewsQuery,
    useGetRoundTypesQuery,
    type JobDetail,
    type RoundTypeItem,
} from "../api";
import { useStartSequence } from "../hooks";
import { formatShortDate } from "../helpers";
import { PAGE_SIZE } from "../constants";
import { useToast } from "../toast/ToastProvider";
import AppNav from "../components/AppNav";
import Button from "../components/Button";
import DeleteJobModal from "../components/DeleteJobModal";
import ExpandableText from "../components/ExpandableText";
import InterviewsTable from "../components/InterviewsTable";
import JobDetailSkeleton from "../components/JobDetailSkeleton";
import JobEditCard from "../components/JobEditCard";
import OverwriteInterviewModal from "../components/OverwriteInterviewModal";
import Pagination from "../components/Pagination";
import RoundCard, { RoundCardSkeleton } from "../components/RoundCard";
import StartingOverlay from "../components/StartingOverlay";

export default function JobDetailPage() {
    const { id } = useParams();
    const jobId = id ?? ""; // always present on /jobs/:id
    const navigate = useNavigate();
    const { toast } = useToast();

    const { data: job, isLoading, error } = useGetJobQuery(jobId);
    const { data: roundsData, isLoading: roundsLoading } = useGetRoundTypesQuery();

    // This job's simulations, newest first, plus the one resumable interview (for its Resume button).
    const [simPage, setSimPage] = useState(1);
    const { data: simsData, isFetching: simsFetching } = useGetMyInterviewsQuery({ job: jobId, page: simPage, size: PAGE_SIZE });
    const { data: resumableData } = useGetMyInterviewsQuery({ resumable: true });
    const resumableId = resumableData?.items[0]?.interview_id ?? null;

    const startSequence = useStartSequence();
    function onStartRound(job: JobDetail, round: RoundTypeItem) {
        startSequence.start(
            { job: job.job_id, round: round.slug },
            {
                role: job.role_name,
                level: job.level_name,
                company: job.company,
                round: round.name,
                hasCodeEditor: round.has_code_editor,
            },
        );
    }

    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleteJob, { isLoading: deleting }] = useDeleteJobMutation();
    async function onDelete() {
        try {
            await deleteJob(jobId).unwrap();
            toast("Job deleted", { variant: "success" });
            navigate("/jobs", { replace: true });
        } catch {
            setConfirmDelete(false);
            toast("Couldn't delete the job. Try again.", { variant: "error" });
        }
    }

    if (isLoading) return <JobDetailSkeleton />;

    if (error || !job) {
        return (
            <div className="min-h-screen bg-bg text-ink">
                <AppNav />
                <p className="px-7 py-10 text-[13.5px] text-gap">Couldn't load this job.</p>
            </div>
        );
    }

    const jobName = `${job.company} · ${job.title}`;

    return (
        <div className="min-h-screen bg-bg text-ink">
            <OverwriteInterviewModal
                open={startSequence.confirmOpen}
                onClose={startSequence.cancel}
                onConfirm={startSequence.confirm}
            />
            {startSequence.starting && <StartingOverlay message={`Preparing your ${job.company} round…`} />}
            <DeleteJobModal
                open={confirmDelete}
                jobName={jobName}
                deleting={deleting}
                onClose={() => setConfirmDelete(false)}
                onConfirm={onDelete}
            />

            <AppNav />

            <div className="mx-auto max-w-[1280px]">
                {/* Header */}
                <div className="border-b border-divider px-7 pb-5 pt-[22px]">
                    <div className="text-[13px] text-neutral-400">
                        <Link to="/jobs" className="text-neutral-400 hover:text-accent">
                            Jobs
                        </Link>{" "}
                        / <span className="text-neutral-300">{job.company}</span>
                    </div>
                    <div className="mt-2 flex items-start justify-between gap-5">
                        <div>
                            <h1 className="font-heading text-[29px] font-medium leading-[1.1] tracking-[-0.02em]">
                                {jobName}
                            </h1>
                            <p className="mt-1.5 text-[13px] text-neutral-400">
                                {job.role_name} · {job.level_name} · Added {formatShortDate(job.created_at)}
                            </p>
                        </div>
                        <Button variant="secondary" className="text-[13px]" onClick={() => setConfirmDelete(true)}>
                            Delete job
                        </Button>
                    </div>
                    <p className="mt-3 max-w-[820px] text-[14px] leading-[1.5] text-neutral-300 [text-wrap:pretty]">
                        {job.summary}
                    </p>
                </div>

                {/* Body — rounds + simulations on the left, details on the right */}
                <div className="grid grid-cols-1 gap-6 px-7 pb-8 pt-6 lg:grid-cols-[1fr_400px]">
                    <div className="flex min-w-0 flex-col gap-6">
                        <section>
                            <h2 className="font-heading text-[23px] font-medium">Practise a round</h2>
                            <p className="mt-1 text-[13px] text-neutral-400">
                                Each round is written for this job: the questions and how they're graded.
                            </p>
                            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                                {roundsLoading
                                    ? Array.from({ length: 3 }).map((_, i) => <RoundCardSkeleton key={i} />)
                                    : (roundsData?.items ?? []).map((round) => (
                                          <RoundCard
                                              key={round.slug}
                                              round={round}
                                              disabled={startSequence.starting || startSequence.resumableLoading}
                                              onStart={() => onStartRound(job, round)}
                                          />
                                      ))}
                            </div>
                        </section>

                        <section className="rounded-md border border-divider px-[22px] pb-2 pt-[18px]">
                            <h2 className="mb-2 font-heading text-[23px] font-medium">Simulations</h2>
                            <InterviewsTable
                                interviews={simsData?.items ?? []}
                                resumableId={resumableId}
                                loading={simsFetching}
                                skeletonRows={3}
                                emptyMessage="No rounds yet — start one above."
                            />
                            {!simsFetching && (
                                <Pagination
                                    page={simsData?.page ?? simPage}
                                    totalPages={simsData?.pages ?? 0}
                                    onPageChange={setSimPage}
                                />
                            )}
                        </section>
                    </div>

                    <div className="flex flex-col gap-6">
                        <JobEditCard job={job} />
                        <section className="rounded-md border border-divider px-[22px] pb-[18px] pt-5">
                            <h2 className="font-heading text-[23px] font-medium">Job posting</h2>
                            <div className="mt-3 whitespace-pre-line text-[13.5px] leading-[1.5] text-neutral-300">
                                <ExpandableText text={job.description} />
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}
