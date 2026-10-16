/**
 * "Save to My questions" on one scorecard question card of a JOB interview. Saving claims the generated
 * question as the caller's own (read-only) practice question; once saved, the button becomes a "Saved"
 * link to the Questions page. `saved` comes from the detail's `saved_question_ids`, which the mutation's
 * tag invalidation refreshes.
 *
 * OPTIMISTIC: a click shows "Saved" at once, without waiting for the request and then the refetch (in
 * between, the not-yet-refetched `saved` would flash "Save to My questions" again). A failed save
 * reverts it and shows an error toast.
 */
import { useState } from "react";
import { Link } from "react-router";
import { BookmarkSimple } from "@phosphor-icons/react";
import { useClaimInterviewQuestionMutation } from "../api";
import { errorDetail } from "../helpers";
import { useToast } from "../toast/ToastProvider";
import Button from "./Button";

export default function SaveQuestionButton({
    interviewId,
    slug,
    saved,
}: {
    interviewId: string;
    slug: string;
    saved: boolean;
}) {
    const [claimQuestion] = useClaimInterviewQuestionMutation();
    const { toast } = useToast();
    const [optimisticSaved, setOptimisticSaved] = useState(false);

    if (saved || optimisticSaved) {
        return (
            <Link
                to="/questions"
                className="inline-flex items-center gap-1.5 text-[12.5px] text-accent-300 hover:text-accent"
            >
                <BookmarkSimple size={15} weight="fill" />
                Saved
            </Link>
        );
    }

    async function onSave() {
        // 1. show it saved right away (this also hides the button, so it can't be double-clicked)
        setOptimisticSaved(true);
        try {
            await claimQuestion({ interviewId, slug }).unwrap();
            toast("Saved to My questions", { variant: "success" });
        } catch (e) {
            // 2. the save failed: put the button back
            setOptimisticSaved(false);
            toast(errorDetail(e) ?? "Couldn't save the question. Try again.", { variant: "error" });
        }
    }

    return (
        <Button variant="secondary" onClick={onSave} className="text-[12.5px]">
            <BookmarkSimple size={15} weight="regular" />
            Save to My questions
        </Button>
    );
}
