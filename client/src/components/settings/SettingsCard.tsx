/**
 * The shared chrome for one Settings section — the bordered card + heading (and an optional one-line
 * description under it). A dumb shell: it takes `children` and knows nothing about what's inside, so
 * each concern (avatar, name, defaults, email, password) is its own self-contained card that just
 * supplies its form as children. Matches the card styling used across the dashboard.
 *
 * No top margin on the content: each card controls its own inner spacing (its first element carries
 * its own `mt-*`), so this shell never double-spaces a card that already spaces itself.
 */
import type { ReactNode } from "react";

export default function SettingsCard({
    title,
    description,
    children,
}: {
    title: string;
    description?: string;
    children: ReactNode;
}) {
    return (
        <section className="rounded-md border border-divider px-[22px] pb-[22px] pt-5">
            <h2 className="font-heading text-[23px] font-medium">{title}</h2>
            {description && <p className="mt-1 text-[13px] text-neutral-500">{description}</p>}
            {children}
        </section>
    );
}
