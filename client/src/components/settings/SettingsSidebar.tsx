/**
 * The sidebar shared by the account pages (Profile, User settings, Interview settings), rendered by
 * SettingsLayout. Plain NavLinks: the active page takes ink on a raised background, the rest the muted
 * neutral, matching AppNav's hover accent. A row on narrow screens, a column beside the content on wide.
 */
import { NavLink } from "react-router";
import { Gear, Microphone, User } from "@phosphor-icons/react";

const SETTINGS_NAV_ITEMS = [
    { to: "/settings/profile", label: "Profile", icon: User },
    { to: "/settings/user", label: "User settings", icon: Gear },
    { to: "/settings/interview", label: "Interview settings", icon: Microphone },
];

function sidebarLinkClass({ isActive }: { isActive: boolean }) {
    const base = "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors";
    return isActive
        ? `${base} bg-neutral-800 text-ink`
        : `${base} text-neutral-400 hover:text-accent`;
}

export default function SettingsSidebar() {
    return (
        <nav aria-label="Account pages" className="flex gap-1 md:flex-col">
            {SETTINGS_NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className={sidebarLinkClass}>
                    <Icon size={17} />
                    {label}
                </NavLink>
            ))}
        </nav>
    );
}
