/**
 * One transcript turn — the bordered bubble + avatar used by BOTH the text session
 * (mock 2b) and the interview detail transcript (mock 3b). Two consumers, so it earns
 * being shared.
 *
 * Same width, same alignment, same shape for both speakers — only the border and the
 * kicker color differ: interviewer bubbles use the divider border + a neutral kicker;
 * your bubbles use the accent border + an accent-300 kicker.
 */
import type { ReactNode } from "react";
import { Sparkle } from "@phosphor-icons/react";
import UserAvatar from "./UserAvatar";
import FormattedText from "./FormattedText";

type Props = {
    who: "interviewer" | "you";
    kicker: string; // "Interviewer" or "You · 1m 20s"
    text: string;
    timestamp?: string; // right-aligned in the kicker row (detail view only)
    maxWidth?: number; // 560 in session, 600 in detail
    children?: ReactNode; // message actions rendered under the bubble
};

export default function MessageRow({ who, kicker, text, timestamp, maxWidth = 560, children }: Props) {
    const isYou = who === "you";
    return (
        <div className="flex gap-3">
            {/* Avatar — 30px square, AI star for the interviewer, the user's picture-or-initials for you
                (UserAvatar reads the identity from the store, so no avatar prop is threaded in here). */}
            {isYou ? (
                <UserAvatar
                    className="h-[30px] w-[30px] border-neutral-700"
                    textClassName="text-[11px] text-neutral-300"
                />
            ) : (
                <div className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-md border border-neutral-700 text-accent-300">
                    <Sparkle size={15} weight="regular" />
                </div>
            )}

            <div className="flex min-w-0 flex-col gap-2" style={{ maxWidth }}>
                <div
                    className={
                        "rounded-md border px-4 py-3.5 " + (isYou ? "border-accent" : "border-divider")
                    }
                >
                    <div className="mb-1.5 flex items-baseline justify-between gap-4">
                        <span className={"kicker" + (isYou ? " text-accent-300" : "")}>{kicker}</span>
                        {timestamp && <span className="text-[12px] text-neutral-400">{timestamp}</span>}
                    </div>
                    {/* pre-wrap prose + fenced code as <pre>, so a coding answer keeps its indentation */}
                    <FormattedText text={text} className="text-[15px] leading-[1.55]" />
                </div>
                {children}
            </div>
        </div>
    );
}
