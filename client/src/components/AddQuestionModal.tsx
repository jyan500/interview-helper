/**
 * "Add question" dialog — browse ALL questions for the current role+level and toggle which are in the
 * saved "My questions" set. Same paginated QuestionsTable the dashboard section and Questions page use,
 * wrapped in the Modal shell with a sticky SelectionBar in the footer.
 *
 * Row toggles are LOCAL (useQuestionSelection) until Save; Save commits the batch, and the "Questions"
 * tag invalidation re-syncs the dashboard "My questions" table underneath with no manual refetch. This
 * component is mounted only while open (the parent conditionally renders it), so closing discards any
 * unsaved staging — the simple, predictable "close = cancel" behaviour.
 */
import { useState } from "react";
import { useGetQuestionsQuery } from "../api";
import { useQuestionSelection } from "../hooks";
import { PAGE_SIZE } from "../constants";
import Modal from "./Modal";
import Pagination from "./Pagination";
import QuestionsTable from "./QuestionsTable";
import SelectionBar from "./SelectionBar";

export default function AddQuestionModal({
    role,
    level,
    savedTotal,
    onClose,
}: {
    role: string;
    level: string;
    savedTotal: number;
    onClose: () => void;
}) {
    const [page, setPage] = useState(1);
    const { data, isFetching } = useGetQuestionsQuery({ role, level, page, size: PAGE_SIZE });
    const questions = data?.items ?? [];

    const selection = useQuestionSelection(savedTotal);

    return (
        <Modal open onClose={onClose} title="Add questions" widthClass="w-[760px]">
            <p className="mb-3 text-[13.5px] text-neutral-400">
                Every question for this role and level. Tick the ones you want to practise, then Save.
            </p>

            {/* the list scrolls inside the dialog so the footer bar + Save stay in view while paging */}
            <div className="max-h-[52vh] overflow-y-auto">
                <QuestionsTable
                    questions={questions}
                    isChecked={selection.isChecked}
                    onToggle={selection.toggle}
                    loading={isFetching}
                    skeletonRows={PAGE_SIZE}
                    emptyMessage="No questions for this role and level yet."
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
