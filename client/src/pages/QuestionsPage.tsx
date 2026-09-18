/**
 * Questions — browse the bank and curate the saved "My questions" set, the full-page counterpart of
 * the dashboard's Add-question modal. Same QuestionsTable + SelectionBar (stage → Save); saving here
 * re-syncs the dashboard set via the "Questions" cache tag.
 *
 * FILTERS ARE DEFERRED (a later pass — the handoff said so). For now the page scopes to the user's
 * DEFAULT role from their profile (falling back to backend-engineer), across all levels, so it's
 * useful without a filter bar. A role/level picker can slot into the header later.
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

    const [page, setPage] = useState(1);
    const { data, isFetching } = useGetQuestionsQuery({ role: roleSlug, page, size: PAGE_SIZE });
    // the saved count for this role — the base for the SelectionBar's running total (size:1, we only
    // want `.total`). Separate from the paged list above so the count is exact across pages.
    const { data: mineData } = useGetQuestionsQuery({ role: roleSlug, mine: true, size: 1 });
    const savedTotal = mineData?.total ?? 0;
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
                    <QuestionsTable
                        questions={data?.items ?? []}
                        isChecked={selection.isChecked}
                        onToggle={selection.toggle}
                        loading={isFetching}
                        skeletonRows={PAGE_SIZE}
                        emptyMessage="No questions for this role yet."
                    />
                    <Pagination
                        page={data?.page ?? page}
                        totalPages={data?.pages ?? 0}
                        onPageChange={setPage}
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
