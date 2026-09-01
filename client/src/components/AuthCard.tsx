/**
 * The 440px auth card — the standalone form container used by sign up, forgot password
 * and reset password (Nocturne mocks 4b / 4c). Centered on the app ground with the
 * hairline-edge shadow-md elevation. Sign in uses the split-panel shell instead.
 */
import type { ReactNode } from "react";

export default function AuthCard({ children }: { children: ReactNode }) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
            <div className="w-[440px] max-w-full rounded-md bg-bg px-10 py-9 shadow-md">{children}</div>
        </div>
    );
}

/** The brand wordmark shown at the top of the auth cards / panel. */
export function Brand({ size = 17 }: { size?: number }) {
    return (
        <span
            className="font-heading font-medium tracking-[-0.01em]"
            style={{ fontSize: size }}
        >
            Interview Helper
        </span>
    );
}

/**
 * A 3-segment password-strength meter (design element from mocks 4b / 4c). `score` is
 * 0–3; the label sits to the right. Purely presentational — pass whatever score your
 * validation computes.
 */
export function StrengthMeter({ score, label }: { score: number; label: string }) {
    return (
        <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
                <span
                    key={i}
                    className={"h-[3px] flex-1 rounded-[2px] " + (i < score ? "bg-accent" : "bg-neutral-800")}
                />
            ))}
            <span className="ml-1.5 text-[12px] text-neutral-400">{label}</span>
        </div>
    );
}
