/**
 * The top navigation bar — shared chrome for the Dashboard and Interviews screens
 * (Nocturne mocks 1a / 3a / 3b). 58px tall, hairline bottom divider, brand on the
 * left with the two nav links, account email + Sign out on the right.
 *
 * DESIGN/LAYOUT ONLY: `signOut` is wired (it already worked pre-redesign), but the
 * links are plain routes — the nav itself carries no interview state.
 */
import { Link, NavLink } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import Button from "./Button";
import UserAvatar from "./UserAvatar";

// NavLink hands its className a { isActive } flag; the active link takes ink + an accent
// underline, the inactive one the muted neutral-400 — matching the mock exactly.
// Both states carry the same border-b-2 (transparent underline when inactive) so switching
// the active tab never jumps the links horizontally. The group is baseline-aligned with the
// brand so the link text sits on the "Interview Helper" baseline.
function navLinkClass({ isActive }: { isActive: boolean }) {
    const base = "border-b-2 pb-0.5";
    return isActive
        ? `${base} text-ink border-accent`
        : `${base} text-neutral-400 border-transparent hover:text-accent`;
}

export default function AppNav() {
    const { session, signOut } = useAuth();

    return (
        <nav className="nav flex h-[58px] items-center justify-between border-b border-divider px-7">
            <div className="flex items-baseline gap-[26px]">
                <span className="font-heading text-[20px] font-medium tracking-[0.02em]">
                    Interview Helper
                </span>
                <div className="flex items-baseline gap-[18px] text-sm">
                    <NavLink to="/" end className={navLinkClass}>
                        Dashboard
                    </NavLink>
                    <NavLink to="/interviews" className={navLinkClass}>
                        Interviews
                    </NavLink>
                    <NavLink to="/questions" className={navLinkClass}>
                        Questions
                    </NavLink>
                    <NavLink to="/jobs" className={navLinkClass}>
                        Jobs
                    </NavLink>
                </div>
            </div>

            <div className="flex items-center gap-[14px] text-[13px] text-neutral-300">
                {/* The account avatar (picture-or-initials) doubles as the entry to the settings page,
                    where the profile picture is changed. UserAvatar self-supplies from the store. */}
                <Link to="/settings" aria-label="Account settings" title="Account settings" className="rounded-md">
                    <UserAvatar
                        className="h-[30px] w-[30px] border-neutral-700 transition-colors hover:border-accent"
                        textClassName="text-[11px] text-neutral-300"
                    />
                </Link>
                <span>{session?.user?.user_metadata?.display_name ?? ""}</span>
                <Button variant="secondary" className="text-[13px]" onClick={() => signOut()}>
                    Sign out
                </Button>
            </div>
        </nav>
    );
}
