import type { ReactNode } from "react";
import { Microphone, SpeakerHigh, Sparkle } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import UserAvatar from "../UserAvatar";

export default function ParticipantCell({
    ai,
    name,
    role,
    speaking,
    className = "",
    footer = null,
}: {
    ai?: boolean;
    name: string;
    role: string;
    speaking: boolean;
    className?: string;
    // Content for the reserved slot below the Speaking/Listening tag (the "You" cell's "Still there?"
    // countdown). The slot's height is reserved unconditionally in BOTH cells regardless of `footer`,
    // so toggling its content never reflows the box — that's what kills the layout shift.
    footer?: ReactNode;
}) {
    // Zoom-style status icon — a mic for the candidate, a speaker for the interviewer — that pulses
    // (accent + filled) while that participant is making sound, idle/neutral otherwise. Fixed-height
    // slot so the cell doesn't reflow as it toggles.
    const StatusIcon: Icon = ai ? SpeakerHigh : Microphone;
    return (
        <div className={"flex flex-col items-center gap-3 px-[22px] py-[26px] " + className}>
            {ai ? (
                <div className="flex h-16 w-16 items-center justify-center rounded-md border border-accent text-accent-300">
                    <Sparkle size={26} weight="regular" />
                </div>
            ) : (
                // The candidate's picture-or-initials, self-supplied from the store (no prop threading).
                <UserAvatar className="h-16 w-16 border-neutral-700 text-neutral-400" textClassName="font-heading text-[22px]" />
            )}
            <div className="text-center">
                <div className="font-heading text-[19px]">{name}</div>
                <div className="text-[12.5px] text-neutral-400">{role}</div>
            </div>
            <div className="flex h-[34px] items-center justify-center">
                <StatusIcon
                    size={26}
                    weight={speaking ? "fill" : "regular"}
                    className={speaking ? "text-accent-300 speaking-pulse" : "text-neutral-600"}
                />
            </div>
            {speaking ? (
                <span className="tag tag-accent">Speaking</span>
            ) : (
                <span className="tag tag-neutral">Listening</span>
            )}
            {/* Reserved footer slot — fixed height in BOTH cells so the "Still there?" badge can appear
                and disappear inside the "You" cell without changing the box's height (no scrollbar flash). */}
            <div className="mt-4 flex h-[38px] items-center justify-center">{footer}</div>
        </div>
    );
}
