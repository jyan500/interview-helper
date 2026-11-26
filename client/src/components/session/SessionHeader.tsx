import { useState } from "react";
import { Gear } from "@phosphor-icons/react";
import Button from "../Button";
import CountdownClock from "../CountdownClock";
import GuidedTour from "../tour/GuidedTour";
import NeedHelpButton from "../tour/NeedHelpButton";
import { sessionTourSteps } from "../tour/steps";
import type { AnswerMode } from "../../constants";

/* ══════════════════════════════════════════════════════════════════════════
   Session header (shared by both modes) — title, mode tag, the "How it works" tour, the countdown
   of a timed interview, and the Settings gear
   ══════════════════════════════════════════════════════════════════════ */
export default function SessionHeader({
    title,
    mode,
    ended,
    remainingMs,
    clockPaused,
    onOpenSettings,
}: {
    title: string;
    mode: AnswerMode;
    ended: boolean;
    // null = untimed: no clock at all
    remainingMs: number | null;
    clockPaused: boolean;
    onOpenSettings: () => void;
}) {
    // The header's "How it works" tour of the session controls. Mounted only while it runs, so each run
    // starts again at step 1. (The coding and diagram panels have their own "Need help?" tours.)
    const [touring, setTouring] = useState(false);

    return (
        <>
            <div className="flex h-[54px] items-center justify-between border-b border-divider px-6">
                <div className="flex items-center gap-3.5">
                    <span className="font-heading text-[17px] font-medium tracking-[-0.01em]">{title}</span>
                    <span className="tag tag-outline capitalize">{mode}</span>
                </div>
                <div className="flex items-center gap-[18px] text-[13px] text-neutral-300">
                    {!ended && <NeedHelpButton label="How it works" onClick={() => setTouring(true)} disabled={touring} />}
                    {/* timed interviews only: an untimed one shows no clock */}
                    {remainingMs !== null && <CountdownClock remainingMs={remainingMs} paused={clockPaused} />}
                    <Button
                        variant="ghost"
                        icon
                        aria-label="Settings"
                        onClick={onOpenSettings}
                        data-tour="session-settings"
                    >
                        <Gear size={17} weight="regular" />
                    </Button>
                </div>
            </div>
            {touring && (
                <GuidedTour buildSteps={() => sessionTourSteps(mode)} onEnd={() => setTouring(false)} />
            )}
        </>
    );
}
