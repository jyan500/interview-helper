/**
 * The "Unfinished session" banner — offers to resume the single most-recent unfinished interview.
 * Shared between the Dashboard and the Past-interviews list (per the handoff: it lives on both).
 *
 * WHY IT OWNS ITS OWN DATA: the "resumable" interview is a derived fact — the most-recently-active
 * one that isn't finished — and both host pages want the SAME answer. So the banner asks for it
 * directly (getMyInterviews with { resumable: true }, which the backend narrows to that one
 * interview) rather than each page pulling the whole history and filtering. It comes back in the
 * list shape as a 0-or-1-element array, so `interviews[0]` is the resumable one (or undefined).
 *
 * "Only the most recent is resumable" is enforced server-side (resume_interview 409s otherwise);
 * this component is just the affordance. "Ignore" dismisses the banner for that interview WITHOUT
 * abandoning it (it stays resumable) — persisted so it doesn't nag on reload, while a newer
 * unfinished interview still surfaces.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import { useGetMyInterviewsQuery } from "../api";
import { addIgnoredInterviewId, loadIgnoredInterviewIds } from "../helpers";

export default function ResumeBanner({ className = "" }: { className?: string }) {
    const navigate = useNavigate();
    const { data } = useGetMyInterviewsQuery({ resumable: true });
    // Seed the ignore set once from localStorage; adding to it re-renders to hide the banner
    // immediately (the persisted copy is for the NEXT load).
    const [ignored, setIgnored] = useState<string[]>(loadIgnoredInterviewIds);

    // The backend returns a 0-or-1-element list, so the resumable interview is the first (or none).
    const resumable = data?.interviews[0];
    if (!resumable || ignored.includes(resumable.interview_id)) return null;

    function onResume() {
        if (!resumable) return; // narrows undefined; the early return above already guaranteed it
        // Hand /session the interview to REDRAW via route state, exactly like the fresh-start flow —
        // but with `resume: true` and no `firstMessage`, so SessionPage hydrates from the transcript
        // instead of seeding a first question. role/level are the human-readable labels for the header.
        navigate("/session", {
            state: {
                interviewId: resumable.interview_id,
                role: resumable.role,
                level: resumable.level,
                resume: true,
            },
        });
    }

    function onIgnore() {
        if (!resumable) return;
        addIgnoredInterviewId(resumable.interview_id);
        setIgnored((prev) => [...prev, resumable.interview_id]);
    }

    return (
        <div
            className={
                "flex items-center justify-between gap-4 rounded-md border border-accent-600 bg-accent-900 px-[18px] py-4 " +
                className
            }
        >
            <div>
                <div className="kicker text-accent-300">Unfinished session</div>
                <div className="mt-0.5 font-heading text-[20px]">
                    {resumable.level} {resumable.role}
                </div>
            </div>
            <div className="flex gap-2">
                <button className="btn btn-ghost" onClick={onIgnore}>
                    Ignore
                </button>
                <button className="btn btn-primary" onClick={onResume}>
                    Resume
                </button>
            </div>
        </div>
    );
}
