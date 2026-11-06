/**
 * SimulationKickoff — the "Start a job interview" card on the Dashboard and the Jobs page: pick one of your saved jobs, then
 * start one of its rounds from the same RoundCards the Job page uses. "New job" opens NewJobModal
 * (paste a posting → the new job's page opens). Self-contained, like SignalPanel: it owns its start
 * sequence and renders that sequence's overwrite confirm + blocking overlay itself.
 *
 * THE JOB PICKER defaults to the job of your MOST RECENT simulation (GET /api/interviews
 * ?simulation=true&size=1 — last-active first, unfinished ones included), i.e. the job you're
 * currently practicing for; with no simulations yet, to your newest saved job. Picking another job
 * overrides it. The default is DERIVED (`picked ?? default`), not seeded into state, so it follows the
 * data without an effect. It's a scope for the cards, not a filter, so it applies on change. The
 * option LIST is alphabetical (getJobOptions sorts by company, then title).
 *
 * The selected job's full row comes from GET /api/jobs/{id} (cached, "Jobs"-tagged): starting a round
 * needs its role/level names for the session header, and the default's LABEL is built from it (the
 * interview row only carries the job's slug + company, not its title).
 *
 * No saved jobs → an empty state that points at "New job" instead of three dead round cards.
 * `alwaysShowDescription` keeps that line above the picker once there are jobs too (the Jobs page).
 *
 * While any of its data loads or reloads, the card's contents are a text-free skeleton (heading, button
 * and labels included). The modals and overlay stay OUTSIDE that swap: saving a job or starting a round
 * invalidates these same queries, and swapping them out would unmount them mid-flow.
 */
import { useState } from "react";
import { skipToken } from "@reduxjs/toolkit/query/react";
import {
    useGetJobQuery,
    useGetJobsQuery,
    useGetMyInterviewsQuery,
    useGetRoundTypesQuery,
    useLazyGetJobOptionsQuery,
} from "../api";
import { useStartSequence } from "../hooks";
import { AsyncPaginateSelect } from "./AsyncPaginateSelect";
import type { SelectOption } from "./AsyncPaginateSelect";
import Button from "./Button";
import NewJobModal from "./NewJobModal";
import OverwriteInterviewModal from "./OverwriteInterviewModal";
import RoundCard, { RoundCardSkeleton } from "./RoundCard";
import { Skeleton } from "./Skeleton";
import StartingOverlay from "./StartingOverlay";
import TimeLimitSelect from "./TimeLimitSelect";

// How many placeholder round cards to show while the job or the round types load — one per seeded
// round format (behavioral, coding, system design).
const ROUND_SKELETONS = 3;

export default function SimulationKickoff({ alwaysShowDescription = false }: { alwaysShowDescription?: boolean }) {
    const [newOpen, setNewOpen] = useState(false);

    // the default: the most recent simulation's job, else the newest saved job (which also tells us
    // whether there are any jobs at all). `picked` is the user's override (null = use the default).
    const { data: lastSim, isLoading: lastSimLoading, isFetching: lastSimFetching } = useGetMyInterviewsQuery({ simulation: true, size: 1 });
    const { data: newestJobs, isFetching: newestFetching } = useGetJobsQuery({ size: 1 });
    const newestJob = newestJobs?.items[0];
    // Wait for the last-interview query to SETTLE before falling back to the newest job: while it's
    // still loading `lastSim` is undefined, and falling through then would briefly select the newest job
    // (instantly labelled when its row is cached, e.g. right after saving it) before the real default
    // lands. Once settled, an account with no job interviews (or a failed lookup) gets the fallback.
    const defaultJobId = lastSimLoading ? null : (lastSim?.items[0]?.job_id ?? newestJob?.job_id ?? null);
    const [picked, setPicked] = useState<SelectOption | null>(null);
    const selectedId = picked?.value ?? defaultJobId;

    const [triggerJobs] = useLazyGetJobOptionsQuery();
    const { data: job, isFetching: jobFetching } = useGetJobQuery(selectedId ?? skipToken);
    const { data: roundsData, isFetching: roundsFetching } = useGetRoundTypesQuery();

    // the picker's value: the user's pick as-is, or the default labelled from its fetched row.
    const selected: SelectOption | null =
        picked ?? (job && job.job_id === defaultJobId ? { value: job.job_id, label: `${job.company} · ${job.title}` } : null);

    const startSequence = useStartSequence();
    // the time limit every round card here starts with (minutes, null = none)
    const [timeLimit, setTimeLimit] = useState<number | null>(null);
    const loading = lastSimFetching || newestFetching || jobFetching || roundsFetching;

    return (
        <section className="rounded-md border border-divider px-[22px] pb-[22px] pt-5">
            <OverwriteInterviewModal
                open={startSequence.confirmOpen}
                onClose={startSequence.cancel}
                onConfirm={startSequence.confirm}
            />
            {startSequence.starting && job && (
                <StartingOverlay message={`Preparing your ${job.company} round…`} />
            )}
            {newOpen && <NewJobModal onClose={() => setNewOpen(false)} />}

            {loading ? (
                <SimulationKickoffSkeleton withDescription={alwaysShowDescription} />
            ) : (
                <>
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="font-heading text-[23px] font-medium">Start a job interview</h2>
                        <Button variant="primary" className="text-sm" onClick={() => setNewOpen(true)}>
                            New job
                        </Button>
                    </div>

                    {(alwaysShowDescription || !newestJob) && (
                        <p className="mt-3 text-[13.5px] text-neutral-400">
                            Save a job posting and we'll write interview rounds for it: behavioral, coding and
                            system design.
                        </p>
                    )}
                    {newestJob && (
                        <>
                            <div className="mt-4 flex flex-col gap-4 sm:flex-row">
                                <div className="field sm:w-[420px]">
                                    <label>Job</label>
                                    <AsyncPaginateSelect
                                        fetchPage={triggerJobs}
                                        value={selected}
                                        onChange={(option) => option && setPicked(option)}
                                        placeholder="Search jobs…"
                                    />
                                </div>
                                <div className="field sm:w-[220px]">
                                    <label>Time limit</label>
                                    <TimeLimitSelect value={timeLimit} onChange={setTimeLimit} />
                                </div>
                            </div>
                            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                                {!job
                                    ? Array.from({ length: ROUND_SKELETONS }).map((_, i) => <RoundCardSkeleton key={i} />)
                                    : (roundsData?.items ?? []).map((round) => (
                                          <RoundCard
                                              key={round.slug}
                                              round={round}
                                              disabled={startSequence.starting || startSequence.resumableLoading}
                                              onStart={() => startSequence.startRound(job, round, timeLimit)}
                                          />
                                      ))}
                            </div>
                        </>
                    )}
                </>
            )}
        </section>
    );
}

// The loading placeholder in the same shape: heading + button, the two fields, the round cards.
function SimulationKickoffSkeleton({ withDescription }: { withDescription: boolean }) {
    return (
        <>
            <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-6 w-56" />
                <Skeleton className="h-8 w-20" />
            </div>
            {withDescription && <Skeleton className="mt-3 h-3.5 w-3/4" />}
            <div className="mt-4 flex flex-col gap-4 sm:flex-row">
                <div className="flex flex-col gap-2 sm:w-[420px]">
                    <Skeleton className="h-3 w-10" />
                    <Skeleton className="h-[38px] w-full" />
                </div>
                <div className="flex flex-col gap-2 sm:w-[220px]">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-[38px] w-full" />
                </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                {Array.from({ length: ROUND_SKELETONS }).map((_, i) => (
                    <RoundCardSkeleton key={i} />
                ))}
            </div>
        </>
    );
}
