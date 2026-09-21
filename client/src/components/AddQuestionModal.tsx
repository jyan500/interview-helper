/**
 * "Add question" dialog — browse the question bank and toggle which questions are in the saved
 * "My questions" set. Same paginated QuestionsTable the dashboard section and Questions page use,
 * wrapped in the Modal shell with a sticky SelectionBar in the footer.
 *
 * FILTERS: the same QuestionFilters row the Questions page uses — a keyword search on the question
 * text, plus role / level / question-type pickers, applied on Search. Unlike the Questions page these
 * are LOCAL state (a modal is transient — no URL persistence). It opens scoped to the dashboard's
 * picked ROLE across all levels; the user narrows from there. Level is matched EXACTLY (exact_level),
 * consistent with the Questions-page browse.
 *
 * Row toggles are LOCAL (useQuestionSelection) until Save; Save commits the batch, and the "Questions"
 * tag invalidation re-syncs the dashboard "My questions" table underneath with no manual refetch. This
 * component is mounted only while open (the parent conditionally renders it), so closing discards any
 * unsaved staging — the simple, predictable "close = cancel" behaviour.
 */
import { useState } from "react";
import { useGetQuestionsQuery } from "../api";
import { useQuestionSelection } from "../hooks";
import type { AppliedSectionFilters } from "../hooks";
import { PAGE_SIZE } from "../constants";
import Modal from "./Modal";
import Pagination from "./Pagination";
import QuestionFilters from "./QuestionFilters";
import QuestionsTable from "./QuestionsTable";
import SelectionBar from "./SelectionBar";

// The applied filter state driving the query. `role` is always present (the bank is per-role); the
// other three are optional (undefined = no filter / "all"). Distinct from the RHF DRAFT inside
// QuestionFilters — this is the COMMITTED state, updated only on Search/Clear.
interface AppliedFilters {
    role: string;
    level?: string;
    questionType?: string;
    q?: string;
    savedOnly?: boolean;
}

export default function AddQuestionModal({
    role,
    roleName,
    onClose,
}: {
    role: string; // the dashboard's picked role slug — the modal opens scoped to it
    roleName: string; // its display name, to seed/reset the role picker's label
    onClose: () => void;
}) {
    // Opens at the dashboard's role, all levels; the user narrows from there.
    const [applied, setApplied] = useState<AppliedFilters>({ role });
    const [page, setPage] = useState(1);

    // exact_level: a level filter means ONLY that level (matching the Questions-page browse). `saved`
    // is the "Saved only" toggle — true narrows to the user's saved set (the Questions page's Saved
    // table equivalent), omitted shows the whole role bank with saved rows pre-checked.
    const { data, isFetching } = useGetQuestionsQuery({
        role: applied.role,
        level: applied.level,
        type: applied.questionType,
        q: applied.q,
        saved: applied.savedOnly ? true : undefined,
        exact_level: true,
        page,
        size: PAGE_SIZE,
    });
    const questions = data?.items ?? [];

    // The SelectionBar's count base = the user's TOTAL saved questions for the current role (all
    // levels), UNAFFECTED by the finer filters — a size-1 query just for `total`. Tracks the role
    // filter so the count stays honest if the user switches role.
    const { data: savedTotalData } = useGetQuestionsQuery({
        role: applied.role,
        saved: true,
        page: 1,
        size: 1,
    });
    const savedTotal = savedTotalData?.total ?? 0;
    const selection = useQuestionSelection(savedTotal);

    // Clear shows once the view diverges from the opening scope (role changed, or any filter active).
    const hasFilters = Boolean(
        applied.role !== role ||
            applied.level ||
            applied.questionType ||
            applied.q ||
            applied.savedOnly,
    );

    function apply(values: AppliedSectionFilters) {
        setApplied({
            // role can't be cleared to none (the picker isn't clearable); guard back to the prop.
            role: values.role ?? role,
            level: values.level ?? undefined,
            questionType: values.questionType ?? undefined,
            q: values.q.trim() || undefined,
            savedOnly: values.savedOnly || undefined,
        });
        setPage(1);
    }

    function clear() {
        setApplied({ role });
        setPage(1);
    }

    return (
        <Modal open onClose={onClose} title="Add questions" widthClass="w-[860px]">
            <p className="mb-3 text-[13.5px] text-neutral-400">
                Browse the question bank and tick the ones you want to practise, then Save. Filter by role,
                level, or type, search the question text, or show only the ones you've already saved.
            </p>

            <QuestionFilters
                roleSlug={applied.role}
                levelSlug={applied.level}
                questionTypeSlug={applied.questionType}
                q={applied.q}
                defaultRole={{ value: role, label: roleName }}
                showClear={hasFilters}
                showSavedFilter
                savedOnly={applied.savedOnly}
                onApply={apply}
                onClear={clear}
            />

            {/* the list scrolls inside the dialog so the footer bar + Save stay in view while paging */}
            <div className="max-h-[52vh] overflow-y-auto">
                <QuestionsTable
                    questions={questions}
                    isChecked={selection.isChecked}
                    onToggle={selection.toggle}
                    loading={isFetching}
                    skeletonRows={PAGE_SIZE}
                    emptyMessage={
                        hasFilters
                            ? "No questions match these filters."
                            : "No questions for this role yet."
                    }
                />
            </div>

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
        </Modal>
    );
}
