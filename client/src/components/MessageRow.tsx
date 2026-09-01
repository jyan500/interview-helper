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
            {/* Avatar — 30px square, AI star for the interviewer, initials for you */}
            <div className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-md border border-neutral-700 text-accent-300">
                {isYou ? <span className="text-[11px] text-neutral-300">JY</span> : <Sparkle size={15} weight="regular" />}
            </div>

            <div className="flex flex-col gap-2" style={{ maxWidth }}>
                <div
                    className={
                        "rounded-md border px-4 py-3.5 " + (isYou ? "border-accent" : "border-divider")
                    }
                >
                    <div className="mb-1.5 flex items-baseline justify-between gap-4">
                        <span className={"kicker" + (isYou ? " text-accent-300" : "")}>{kicker}</span>
                        {timestamp && <span className="text-[12px] text-neutral-400">{timestamp}</span>}
                    </div>
                    <p className="m-0 text-[15px] leading-[1.55] [text-wrap:pretty]">{text}</p>
                </div>
                {children}
            </div>
        </div>
    );
}
