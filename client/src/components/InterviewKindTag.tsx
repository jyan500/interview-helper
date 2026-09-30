/**
 * The small "Job" / "Practice" pill that says which kind an interview is — a Job interview is a round
 * written for a saved job (`job_id` set), a Practice interview asks role + level bank questions. Shown
 * on every past-interview row (InterviewsTable) and the interview detail header, so the two kinds read
 * apart now that the UI calls both "interviews". Uses the ported `.tag` classes.
 */
import { interviewKindOf } from "../helpers";

export default function InterviewKindTag({ jobId }: { jobId: string | null }) {
    const isJob = interviewKindOf({ job_id: jobId }) === "job";
    return (
        <span className={`tag ${isJob ? "tag-accent" : "tag-neutral"} align-middle`}>
            {isJob ? "Job" : "Practice"}
        </span>
    );
}
