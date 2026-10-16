/**
 * The interview detail page's nudge: a job interview's questions can be saved to "My questions" and
 * practiced again later (see SaveQuestionButton). The page renders it only while there's something left
 * to save; the X dismisses it for good, on every interview (persisted under
 * SAVE_QUESTIONS_BANNER_DISMISSED_KEY).
 */
import { useState } from "react";
import { BookmarkSimple, X } from "@phosphor-icons/react";
import { SAVE_QUESTIONS_BANNER_DISMISSED_KEY } from "../constants";
import Banner from "./Banner";
import Button from "./Button";

export default function SaveQuestionsBanner({ className = "" }: { className?: string }) {
    // Seed once from localStorage; dismissing re-renders to hide it now (the stored copy is for later loads).
    const [dismissed, setDismissed] = useState(
        () => localStorage.getItem(SAVE_QUESTIONS_BANNER_DISMISSED_KEY) === "1"
    );
    if (dismissed) return null;

    function onDismiss() {
        localStorage.setItem(SAVE_QUESTIONS_BANNER_DISMISSED_KEY, "1");
        setDismissed(true);
    }

    return (
        <Banner className={className}>
            <div className="flex items-start gap-3">
                <BookmarkSimple size={20} weight="regular" className="mt-0.5 flex-none text-accent-300" />
                <div>
                    <div className="kicker text-accent-300">Stumped by a question?</div>
                    <p className="mt-1.5 text-[13.5px] leading-snug text-neutral-300 [text-wrap:pretty]">
                        Save any question you were unsure of to My questions, then practice it again in a
                        practice interview. Look for "Save to My questions" on each question in the scorecard.
                    </p>
                </div>
            </div>
            <Button variant="ghost" icon aria-label="Dismiss" title="Dismiss" onClick={onDismiss}>
                <X size={17} weight="regular" />
            </Button>
        </Banner>
    );
}
