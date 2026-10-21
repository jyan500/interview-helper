import type { ReactNode } from "react";
import { Question } from "@phosphor-icons/react";
import Tooltip from "./Tooltip";

/**
 * The shared shell for the dashboard signal column's cards (Readiness, Skill breakdown, Work on
 * next, and the scope controls). All of them are the SAME bordered card with a kicker label on top,
 * so the chrome lives here ONCE and each card supplies only its body as children — the same
 * children-taking-shell pattern as Modal. Keeping the shell shared is also what lets a card's
 * loading, empty, and populated states sit inside identical chrome, so only the body region swaps.
 *
 * Pass `help` and the kicker row gets a help icon in the top-right corner that shows it as a tooltip,
 * for explaining what the card's number means without spending body space on it.
 */
export default function SignalCard({
    title,
    help,
    children,
}: {
    title: string;
    help?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="rounded-md border border-divider px-5 py-[18px]">
            <div className="flex items-center justify-between gap-2">
                <div className="kicker">{title}</div>
                {/* align="end" opens the bubble leftward, since the icon sits at the card's right edge */}
                {help && (
                    <Tooltip align="end" content={help}>
                        <button
                            type="button"
                            aria-label={`About ${title}`}
                            className="flex cursor-help items-center text-neutral-500 transition-colors hover:text-ink"
                        >
                            <Question size={16} weight="bold" aria-hidden="true" />
                        </button>
                    </Tooltip>
                )}
            </div>
            {children}
        </div>
    );
}
