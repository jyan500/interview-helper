/**
 * The shared chrome for one Settings section — the bordered card + heading (and an optional one-line
 * description under it). A dumb shell: it takes `children` and knows nothing about what's inside, so
 * each concern (avatar, name, defaults, email, password) is its own self-contained card that just
 * supplies its form as children. Matches the card styling used across the dashboard.
 *
 * No top margin on the content: each card controls its own inner spacing (its first element carries
 * its own `mt-*`), so this shell never double-spaces a card that already spaces itself.
 *
 * `action` is an optional control pinned to the right of the heading (e.g. the Profile page's "Add role").
 */
import type { ReactNode } from "react";

export default function SettingsCard({
    title,
    description,
    action,
    children,
}: {
    title: string;
    description?: string;
    action?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className="rounded-md border border-divider px-[22px] pb-[22px] pt-5">
            <div className="flex items-center justify-between gap-4">
                <h2 className="font-heading text-[23px] font-medium">{title}</h2>
                {action}
            </div>
            {description && <p className="mt-1 text-[13px] text-neutral-500">{description}</p>}
            {children}
        </section>
    );
}
