/**
 * Read-only view of a question saved from a job interview (`is_claimed`). Those can't be edited (the
 * interview that asked them still reads them), so the Questions table offers View instead of Edit. The
 * table row already carries everything shown here, so there's no fetch.
 */
import type { QuestionItem } from "../../api";
import FormattedText from "../FormattedText";
import Modal from "../Modal";

export default function QuestionViewModal({
    question,
    onClose,
}: {
    question: QuestionItem;
    onClose: () => void;
}) {
    return (
        <Modal open onClose={onClose} title={question.title} widthClass="w-[600px]">
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-neutral-400">
                <span className="tag tag-accent">From interview</span>
                <span>
                    {question.type_name}
                    {question.level_name && ` · ${question.level_name}`}
                </span>
            </div>
            {/* a generated coding problem keeps its line breaks (and any example code block) */}
            <div className="mt-4">
                <FormattedText text={question.text} className="text-[14px] leading-[1.5] text-neutral-200" />
            </div>
            <p className="mt-5 text-[12.5px] text-neutral-400 [text-wrap:pretty]">
                Saved from a job interview, so it can't be edited. You can still practice it or delete it.
            </p>
        </Modal>
    );
}
