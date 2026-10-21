/**
 * DeleteQuestionModal — the confirm step for deleting one of the candidate's own questions, shared by
 * the Questions page and the dashboard's QuestionBankCard. Owns the delete mutation and its toasts; the
 * caller only holds which question is pending (`question`, null = closed). Delete archives server-side,
 * so past interviews that asked the question still show it.
 */
import { useDeleteCustomQuestionMutation, type QuestionItem } from "../../api";
import { useToast } from "../../toast/ToastProvider";
import ConfirmDeleteModal from "../ConfirmDeleteModal";

export default function DeleteQuestionModal({
    question,
    onClose,
}: {
    question: QuestionItem | null;
    onClose: () => void;
}) {
    const { toast } = useToast();
    const [deleteQuestion, { isLoading: deleting }] = useDeleteCustomQuestionMutation();

    async function confirmDelete() {
        if (!question) return;
        try {
            await deleteQuestion(question.slug).unwrap();
            toast("Question deleted", { variant: "success" });
            onClose();
        } catch {
            toast("Couldn't delete this question. Try again.", { variant: "error" });
        }
    }

    return (
        <ConfirmDeleteModal
            open={question !== null}
            title="Delete this question?"
            confirmLabel="Delete question"
            deleting={deleting}
            onClose={onClose}
            onConfirm={confirmDelete}
        >
            <strong className="text-ink">"{question?.title}"</strong> will be removed from your
            questions and won't be asked again. Past interviews that asked it keep their results.
        </ConfirmDeleteModal>
    );
}
