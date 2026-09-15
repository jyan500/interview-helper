import type { ReactNode } from "react";

/**
 * The shared shell for the dashboard signal column's cards (Readiness, Skill breakdown, Work on
 * next, and the scope controls). All of them are the SAME bordered card with a kicker label on top,
 * so the chrome lives here ONCE and each card supplies only its body as children — the same
 * children-taking-shell pattern as Modal. Keeping the shell shared is also what lets a card's
 * loading, empty, and populated states sit inside identical chrome, so only the body region swaps.
 */
export default function SignalCard({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="rounded-md border border-divider px-5 py-[18px]">
            <div className="kicker">{title}</div>
            {children}
        </div>
    );
}
