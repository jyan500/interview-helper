/**
 * Full-screen blocking overlay shown while an interview kickoff POST is in flight. Same dark scrim as
 * the <Modal> backdrop (bg-black/60, z-50), so once "Start interview" is clicked nothing else on the
 * page can be interacted with until we navigate to /session. Rendered by DashboardPage for BOTH start
 * paths — the direct start and the post-confirmation start.
 *
 * Presentational and non-dismissable by design: it has no close affordance and disappears only when the
 * caller stops rendering it (on navigate, or on failure).
 */
import { CircleNotch } from "@phosphor-icons/react";

// `message` lets a slower kickoff say what it's doing — a job simulation GENERATES its round first,
// which takes several seconds, so the Job page passes its own line.
export default function StartingOverlay({ message = "Starting your interview…" }: { message?: string }) {
    return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/60">
            <CircleNotch size={40} weight="bold" className="animate-spin text-accent-300" />
            <p className="text-[15px] text-neutral-200">{message}</p>
        </div>
    );
}
