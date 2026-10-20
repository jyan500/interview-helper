/**
 * Create / edit one of the candidate's own questions. With `slug` it loads that question's detail
 * (GET /api/questions/{slug}) and edits it; without, it creates a new one (optionally prefilled from one of
 * the candidate's own questions, see QuestionForm). Mounted only while open, so closing discards the draft.
 *
 * The form mounts only once the detail is in hand, so its defaults are the real values (no re-seeding an
 * already-mounted form); a skeleton matching the form's shape stands in meanwhile.
 */
import { skipToken } from "@reduxjs/toolkit/query/react";
import { useGetCustomQuestionQuery } from "../../api";
import type { SelectOption } from "../AsyncPaginateSelect";
import Modal from "../Modal";
import QuestionForm from "./QuestionForm";
import QuestionFormSkeleton from "./QuestionFormSkeleton";

export default function QuestionModal({
    slug,
    defaultRole,
    onClose,
}: {
    slug?: string;
    defaultRole: SelectOption | null;
    onClose: () => void;
}) {
    const { data: question, isError } = useGetCustomQuestionQuery(slug ?? skipToken);
    const editing = slug !== undefined;

    return (
        <Modal open onClose={onClose} title={editing ? "Edit question" : "Create question"} widthClass="w-[600px]">
            {editing && isError ? (
                <p className="text-[13.5px] text-gap">Couldn't load this question. Close and try again.</p>
            ) : editing && !question ? (
                <QuestionFormSkeleton />
            ) : (
                <QuestionForm question={question} defaultRole={defaultRole} onClose={onClose} />
            )}
        </Modal>
    );
}
