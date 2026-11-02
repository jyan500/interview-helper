/**
 * One step of the dashboard's "Getting started" checklist (GettingStartedCard): a done/not-done icon,
 * the step's title and why-line, and the links that take you to do it. A done step is dimmed but keeps
 * its text and links, so it still reads as a map of the app. OnboardingStepRowSkeleton is its
 * loading shape.
 */
import { CheckCircle, Circle } from "@phosphor-icons/react";
import { Link } from "react-router";
import type { OnboardingStepId } from "../hooks";
import { Skeleton } from "./Skeleton";

export interface OnboardingStep {
    id: OnboardingStepId;
    title: string;
    description: string;
    links: { to: string; label: string }[];
}

export default function OnboardingStepRow({ step, done }: { step: OnboardingStep; done: boolean }) {
    return (
        <li className="flex gap-3 py-3.5">
            {done ? (
                <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-label="Done" />
            ) : (
                <Circle size={20} className="mt-0.5 shrink-0 text-neutral-500" aria-label="Not done yet" />
            )}
            <div className={`min-w-0 ${done ? "opacity-60" : ""}`}>
                <div className="text-[15px] font-medium">{step.title}</div>
                <p className="mt-0.5 text-[13px] leading-[1.5] text-neutral-400">{step.description}</p>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                    {step.links.map((link) => (
                        <Link key={link.label} to={link.to} className="text-[13px] text-accent-300">
                            {link.label}
                        </Link>
                    ))}
                </div>
            </div>
        </li>
    );
}

export function OnboardingStepRowSkeleton() {
    return (
        <li className="flex gap-3 py-3.5">
            <Skeleton className="mt-0.5 h-5 w-5 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-24" />
            </div>
        </li>
    );
}
