/**
 * Questions — browse the bank and curate the saved "My questions" set, the full-page counterpart of
 * the dashboard's Add-question modal.
 *
 * TWO TABLES so the current selection is obvious at a glance instead of hunting through pages:
 *   Saved            — the questions already in the set (server `saved=true`).
 *   Other questions  — everything else for the role (server `saved=false`).
 * Both share ONE useQuestionSelection + one sticky SelectionBar (stage → Save). A checkbox marks
 * intent; on Save the "Questions" tag invalidates and BOTH tables refetch, so a question ticked in
 * "Other" moves up to "Saved" and an unticked "Saved" one drops back down.
 *
 * FILTERS: each table has its OWN filter set (a QuestionFilters row) — a keyword search on the question
 * text, plus role / level / question-type pickers, applied on Search. The two sets are independent and
 * both live in the URL (prefixed `s_*` for Saved, `o_*` for Other, via useSectionFilters), so a deep
 * link reproduces both views and Back/Forward work. Level is matched EXACTLY here (exact_level), unlike
 * the interview-plan's at-or-below rule — a browse filter reads more intuitively that way.
 *
 * ROLE is a required scope (the bank is per-role), so with no role filter a section falls back to the
 * profile's default role (else backend-engineer). The SelectionBar's running count is the UNFILTERED
 * saved total for the Saved section's role, so narrowing the Saved filters never skews it.
 */
import { useGetProfileQuery, useGetQuestionsQuery } from "../api";
import { useQuestionSelection, useSectionFilters } from "../hooks";
import { PAGE_SIZE } from "../constants";
import AppNav from "../components/AppNav";
import QuestionFilters from "../components/QuestionFilters";
import QuestionsTable from "../components/QuestionsTable";
import SelectionBar from "../components/SelectionBar";
import Pagination from "../components/Pagination";

export default function QuestionsPage() {
    const { data: profile } = useGetProfileQuery();
    // The fallback role when a section has no role filter — the profile default, else backend-engineer.
    const defaultRoleSlug = profile?.role?.slug ?? "backend-engineer";
    const defaultRoleName = profile?.role?.name ?? "Backend Engineer";
    const defaultRole = { value: defaultRoleSlug, label: defaultRoleName };

    // Each table's filter set + page, backed by its own slice of the URL.
    const saved = useSectionFilters("s_");
    const other = useSectionFilters("o_");

    // Effective role per section: the filter's role, else the default.
    const savedRoleSlug = saved.role ?? defaultRoleSlug;
    const otherRoleSlug = other.role ?? defaultRoleSlug;

    // exact_level: on the browse page a level filter means ONLY that level (not the plan's at-or-below).
    const { data: savedData, isFetching: savedFetching } = useGetQuestionsQuery({
        role: savedRoleSlug,
        saved: true,
        q: saved.q,
        level: saved.level,
        type: saved.questionType,
        exact_level: true,
        page: saved.page,
        size: PAGE_SIZE,
    });
    const { data: restData, isFetching: restFetching } = useGetQuestionsQuery({
        role: otherRoleSlug,
        saved: false,
        q: other.q,
        level: other.level,
        type: other.questionType,
        exact_level: true,
        page: other.page,
        size: PAGE_SIZE,
    });

    // The SelectionBar's count base = the user's TOTAL saved questions for the Saved section's role,
    // UNAFFECTED by the finer filters (a size-1 query just for `total`). Filtering the Saved table
    // narrows the rows shown, not how many the user has saved, so this stays the honest count.
    const { data: savedTotalData } = useGetQuestionsQuery({
        role: savedRoleSlug,
        saved: true,
        page: 1,
        size: 1,
    });
    const savedTotal = savedTotalData?.total ?? 0;
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
                        Tick the ones you want to practise, then Save — your next interview asks your saved
                        questions. If you don't save any, we'll choose 3 of increasing difficulty for you.
                    </p>
                </div>

                <div className="px-7 pb-[26px] pt-2">
                    {/* Saved — the current set (server truth). Unticking one stages a removal; on Save
                        it drops into "Other questions" below. */}
                    <h2 className="mb-4 font-heading text-[19px] font-medium">
                        Saved <span className="text-neutral-400">{savedTotal > 0 ? `(${savedTotal})` : ""}</span>
                    </h2>
                    <QuestionFilters
                        roleSlug={savedRoleSlug}
                        levelSlug={saved.level}
                        questionTypeSlug={saved.questionType}
                        q={saved.q}
                        defaultRole={defaultRole}
                        showClear={saved.hasFilters}
                        onApply={saved.apply}
                        onClear={saved.clear}
                    />
                    <QuestionsTable
                        questions={savedData?.items ?? []}
                        isChecked={selection.isChecked}
                        onToggle={selection.toggle}
                        loading={savedFetching}
                        skeletonRows={3}
                        emptyMessage={
                            saved.hasFilters
                                ? "No saved questions match these filters."
                                : "No saved questions yet — tick some below, or start and we'll pick 3 for you."
                        }
                    />
                    <Pagination
                        page={savedData?.page ?? saved.page}
                        totalPages={savedData?.pages ?? 0}
                        onPageChange={saved.goToPage}
                    />

                    {/* Everything else for this role. Ticking one stages an add; on Save it moves up. */}
                    <h2 className="mb-4 mt-8 font-heading text-[19px] font-medium">Other questions</h2>
                    <QuestionFilters
                        roleSlug={otherRoleSlug}
                        levelSlug={other.level}
                        questionTypeSlug={other.questionType}
                        q={other.q}
                        defaultRole={defaultRole}
                        showClear={other.hasFilters}
                        onApply={other.apply}
                        onClear={other.clear}
                    />
                    <QuestionsTable
                        questions={restData?.items ?? []}
                        isChecked={selection.isChecked}
                        onToggle={selection.toggle}
                        loading={restFetching}
                        skeletonRows={PAGE_SIZE}
                        emptyMessage={
                            other.hasFilters
                                ? "No questions match these filters."
                                : "Nothing left — you've saved every question for this role."
                        }
                    />
                    <Pagination
                        page={restData?.page ?? other.page}
                        totalPages={restData?.pages ?? 0}
                        onPageChange={other.goToPage}
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
