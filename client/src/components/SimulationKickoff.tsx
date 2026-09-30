/**
 * SimulationKickoff — the dashboard's "Start a simulation" card: pick one of your saved jobs, then
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
import StartingOverlay from "./StartingOverlay";

// How many placeholder round cards to show while the job or the round types load — one per seeded
// round format (behavioral, coding, system design).
const ROUND_SKELETONS = 3;

export default function SimulationKickoff() {
    const [newOpen, setNewOpen] = useState(false);

    // the default: the most recent simulation's job, else the newest saved job (which also tells us
    // whether there are any jobs at all). `picked` is the user's override (null = use the default).
    const { data: lastSim, isLoading: lastSimLoading } = useGetMyInterviewsQuery({ simulation: true, size: 1 });
    const { data: newestJobs, isLoading: newestLoading } = useGetJobsQuery({ size: 1 });
    const newestJob = newestJobs?.items[0];
    const defaultJobId = lastSim?.items[0]?.job_id ?? newestJob?.job_id ?? null;
    const defaultLoading = lastSimLoading || newestLoading;
    const [picked, setPicked] = useState<SelectOption | null>(null);
    const selectedId = picked?.value ?? defaultJobId;

    const [triggerJobs] = useLazyGetJobOptionsQuery();
    const { data: job, isFetching: jobFetching } = useGetJobQuery(selectedId ?? skipToken);
    const { data: roundsData, isLoading: roundsLoading } = useGetRoundTypesQuery();

    // the picker's value: the user's pick as-is, or the default labelled from its fetched row.
    const selected: SelectOption | null =
        picked ?? (job && job.job_id === defaultJobId ? { value: job.job_id, label: `${job.company} · ${job.title}` } : null);

    const startSequence = useStartSequence();
    const hasJobs = newestLoading || Boolean(newestJob);
    const cardsLoading = defaultLoading || roundsLoading || jobFetching || !job;

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

            <div className="flex items-center justify-between gap-3">
                <h2 className="font-heading text-[23px] font-medium">Start a job interview</h2>
                <Button variant="secondary" className="text-[13px]" onClick={() => setNewOpen(true)}>
                    New job
                </Button>
            </div>

            {!hasJobs ? (
                <p className="mt-3 text-[13.5px] text-neutral-400">
                    Save a job posting and we'll write interview rounds for it: behavioral, coding and
                    system design, graded against that job.
                </p>
            ) : (
                <>
                    <div className="field mt-4 sm:max-w-[420px]">
                        <label>Job</label>
                        <AsyncPaginateSelect
                            fetchPage={triggerJobs}
                            value={selected}
                            onChange={(option) => option && setPicked(option)}
                            placeholder="Search jobs…"
                            isLoading={!picked && (defaultLoading || jobFetching)}
                        />
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                        {cardsLoading
                            ? Array.from({ length: ROUND_SKELETONS }).map((_, i) => <RoundCardSkeleton key={i} />)
                            : (roundsData?.items ?? []).map((round) => (
                                  <RoundCard
                                      key={round.slug}
                                      round={round}
                                      disabled={startSequence.starting || startSequence.resumableLoading}
                                      onStart={() => startSequence.startRound(job, round)}
                                  />
                              ))}
                    </div>
                </>
            )}
        </section>
    );
}
