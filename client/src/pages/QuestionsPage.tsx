/**
 * Questions — browse the bank and curate the saved "My questions" set, the full-page counterpart of
 * the dashboard's Add-question modal.
 *
 * TWO TABLES so the current selection is obvious at a glance instead of hunting through pages:
 *   Saved            — the questions already in the set (server `saved=true`).
 *   Other questions  — everything else for the role (server `saved=false`).
 * Both share ONE useQuestionSelection + one sticky SelectionBar (stage → Save). A checkbox marks
 * intent; on Save the "Questions" tag invalidates and BOTH tables refetch, so a question ticked in
 * "Other" moves up to "Saved" and an unticked "Saved" one drops back down. Each table paginates on
 * its own page cursor.
 *
 * FILTERS ARE DEFERRED (a later pass — the handoff said so): the page scopes to the user's DEFAULT
 * role from their profile (falling back to backend-engineer), across all levels. A role/level picker
 * can slot into the header later.
 */
import { useState } from "react";
import { useGetProfileQuery, useGetQuestionsQuery } from "../api";
import { useQuestionSelection } from "../hooks";
import { PAGE_SIZE } from "../constants";
import AppNav from "../components/AppNav";
import QuestionsTable from "../components/QuestionsTable";
import SelectionBar from "../components/SelectionBar";
import Pagination from "../components/Pagination";

export default function QuestionsPage() {
    const { data: profile } = useGetProfileQuery();
    // scope to the profile's default role (else backend-engineer), all levels (no level filter).
    const roleSlug = profile?.role?.slug ?? "backend-engineer";
    const roleName = profile?.role?.name ?? "Backend Engineer";

    // each table has its own page cursor.
    const [savedPage, setSavedPage] = useState(1);
    const [restPage, setRestPage] = useState(1);

    const { data: savedData, isFetching: savedFetching } = useGetQuestionsQuery({
        role: roleSlug,
        saved: true,
        page: savedPage,
        size: PAGE_SIZE,
    });
    const { data: restData, isFetching: restFetching } = useGetQuestionsQuery({
        role: roleSlug,
        saved: false,
        page: restPage,
        size: PAGE_SIZE,
    });

    // the saved table's total is the base for the SelectionBar's running count.
    const savedTotal = savedData?.total ?? 0;
    const selection = useQuestionSelection(savedTotal);

    return (
        <div className="min-h-screen bg-bg text-ink">
            <AppNav />

            <div className="mx-auto max-w-[1280px]">
                <div className="px-7 pb-3 pt-[26px]">
                    <h1 className="font-heading text-[30px] font-medium leading-[1.1] tracking-[-0.02em]">
                        Questions
                    </h1>
                    <p className="mt-2 text-[13.5px] text-neutral-400">
                        Showing questions for <span className="text-ink">{roleName}</span>. Tick the ones
                        you want to practise, then Save — your next interview asks your saved questions. If
                        you don't save any, we'll choose 3 of increasing difficulty for you.
                    </p>
                </div>

                <div className="px-7 pb-[26px] pt-2">
                    {/* Saved — the current set (server truth). Unticking one stages a removal; on Save
                        it drops into "Other questions" below. */}
                    <h2 className="mb-2 font-heading text-[19px] font-medium">
                        Saved <span className="text-neutral-400">{savedTotal > 0 ? `(${savedTotal})` : ""}</span>
                    </h2>
                    <QuestionsTable
                        questions={savedData?.items ?? []}
                        isChecked={selection.isChecked}
                        onToggle={selection.toggle}
                        loading={savedFetching}
                        skeletonRows={3}
                        emptyMessage="No saved questions yet — tick some below, or start and we'll pick 3 for you."
                    />
                    <Pagination
                        page={savedData?.page ?? savedPage}
                        totalPages={savedData?.pages ?? 0}
                        onPageChange={setSavedPage}
                    />

                    {/* Everything else for this role. Ticking one stages an add; on Save it moves up. */}
                    <h2 className="mb-2 mt-8 font-heading text-[19px] font-medium">Other questions</h2>
                    <QuestionsTable
                        questions={restData?.items ?? []}
                        isChecked={selection.isChecked}
                        onToggle={selection.toggle}
                        loading={restFetching}
                        skeletonRows={PAGE_SIZE}
                        emptyMessage="Nothing left — you've saved every question for this role."
                    />
                    <Pagination
                        page={restData?.page ?? restPage}
                        totalPages={restData?.pages ?? 0}
                        onPageChange={setRestPage}
                    />

                    <SelectionBar
                        count={selection.selectedCount}
                        dirty={selection.dirty}
                        saving={selection.saving}
                        onSave={selection.save}
                        onReset={selection.reset}
                    />
                </div>
            </div>
        </div>
    );
}
