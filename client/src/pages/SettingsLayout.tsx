/**
 * The shared chrome for the account pages under /settings (profile, user, interview) — a layout route: the
 * app nav, the sidebar linking between them, and the page itself in the <Outlet>. Each page is just its
 * heading + cards; nothing is threaded through here.
 */
import { Outlet } from "react-router";
import AppNav from "../components/AppNav";
import SettingsSidebar from "../components/settings/SettingsSidebar";

export default function SettingsLayout() {
    return (
        <div className="min-h-screen bg-bg text-ink">
            <AppNav />

            <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-7 py-[22px] md:flex-row md:gap-10">
                <aside className="md:w-[200px] md:shrink-0 md:pt-1.5">
                    <SettingsSidebar />
                </aside>
                <main className="min-w-0 flex-1">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
