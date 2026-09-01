/**
 * The top navigation bar — shared chrome for the Dashboard and Interviews screens
 * (Nocturne mocks 1a / 3a / 3b). 58px tall, hairline bottom divider, brand on the
 * left with the two nav links, account email + Sign out on the right.
 *
 * DESIGN/LAYOUT ONLY: `signOut` is wired (it already worked pre-redesign), but the
 * links are plain routes — the nav itself carries no interview state.
 */
import { NavLink } from "react-router";
import { useAuth } from "../auth/AuthProvider";

// NavLink hands its className a { isActive } flag; the active link takes ink + an accent
// underline, the inactive one the muted neutral-400 — matching the mock exactly.
function navLinkClass({ isActive }: { isActive: boolean }) {
    return isActive
        ? "text-ink border-b-2 border-accent pb-0.5"
        : "text-neutral-400 hover:text-accent";
}

export default function AppNav() {
    const { session, signOut } = useAuth();

    return (
        <nav className="nav flex h-[58px] items-center justify-between border-b border-divider px-7">
            <div className="flex items-center gap-[26px]">
                <span className="font-heading text-[20px] font-medium tracking-[0.02em]">
                    Interview Helper
                </span>
                <div className="flex gap-[18px] text-sm">
                    <NavLink to="/" end className={navLinkClass}>
                        Dashboard
                    </NavLink>
                    <NavLink to="/interviews" className={navLinkClass}>
                        Interviews
                    </NavLink>
                </div>
            </div>

            <div className="flex items-center gap-[14px] text-[13px] text-neutral-300">
                <span>{session?.user.email ?? "you@example.com"}</span>
                <button className="btn btn-secondary text-[13px]" onClick={() => signOut()}>
                    Sign out
                </button>
            </div>
        </nav>
    );
}
