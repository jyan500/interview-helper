/**
 * The accent-tinted banner box shared by ResumeBanner and SaveQuestionsBanner: a row with the message on
 * the left and its actions on the right. It owns only the chrome; callers pass the content as `children`.
 */
import type { ReactNode } from "react";

export default function Banner({ className = "", children }: { className?: string; children: ReactNode }) {
    return (
        <div
            className={
                "flex items-center justify-between gap-4 rounded-md border border-accent-600 bg-accent-900 px-[18px] py-4 " +
                className
            }
        >
            {children}
        </div>
    );
}
