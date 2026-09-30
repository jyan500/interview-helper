/**
 * QuestionBankCard — the dashboard's "Your question bank": a read-only call-back to BANK practice
 * (general role + level interviews), which lives on the Questions page now that the dashboard is
 * simulation-first. It previews the saved "My questions" for the profile's DEFAULT role + level — the
 * same scope the Questions page's kickoff pre-fills — and links there to curate them or start one.
 *
 * The preview uses the interview plan's AT-OR-BELOW level rule (no exact_level), so these are the
 * questions a bank interview at that level would actually ask. The first PREVIEW_ROWS are shown with
 * a "+N more" count from the page `total`. No saved questions → the interview's fallback is spelled
 * out (3 of increasing difficulty). No default role/level → a prompt to set one, since there's no
 * scope to preview.
 *
 * Self-contained (fetches its own data), like SignalPanel and SimulationKickoff.
 */
import { Link } from "react-router";
import { skipToken } from "@reduxjs/toolkit/query/react";
import { useGetProfileQuery, useGetQuestionsQuery } from "../api";
import QuestionsTable from "./QuestionsTable";
import { Skeleton } from "./Skeleton";

// How many saved questions the preview lists before the "+N more" line takes over.
const PREVIEW_ROWS = 4;

export default function QuestionBankCard() {
    const { data: profile, isLoading: profileLoading } = useGetProfileQuery();
    const role = profile?.role;
    const level = profile?.level;

    const { data: saved, isFetching } = useGetQuestionsQuery(
        role && level ? { role: role.slug, level: level.slug, saved: true, page: 1, size: PREVIEW_ROWS } : skipToken,
    );
    const more = saved ? saved.total - saved.items.length : 0;

    return (
        <section className="rounded-md border border-divider px-[22px] pb-3 pt-[18px]">
            <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-heading text-[23px] font-medium">Your question bank</h2>
                <Link to="/questions" className="text-[13px] text-accent-300">
                    Practice &amp; manage
                </Link>
            </div>

            {profileLoading ? (
                <Skeleton className="mt-2 h-3.5 w-3/4" />
            ) : !role || !level ? (
                <p className="mt-2 pb-3 text-[13.5px] text-neutral-400">
                    Besides job interviews, you can practice general questions for a role and level. Pick a
                    default role and level on the{" "}
                    <Link to="/questions" className="text-accent-300">Questions page</Link> to see your
                    saved questions here.
                </p>
            ) : (
                <>
                    <p className="mt-1 mb-2 text-[13px] text-neutral-400">
                        General practice outside a job: the saved questions a {role.name} · {level.name}{" "}
                        interview asks.
                    </p>
                    <QuestionsTable
                        questions={saved?.items ?? []}
                        loading={isFetching}
                        skeletonRows={PREVIEW_ROWS}
                        emptyMessage="No saved questions yet. A practice interview will pick 3 of increasing difficulty for you."
                    />
                    {!isFetching && more > 0 && (
                        <Link to="/questions" className="block px-2 pb-2 pt-1 text-[13px] text-neutral-400 hover:text-accent">
                            +{more} more saved
                        </Link>
                    )}
                </>
            )}
        </section>
    );
}
