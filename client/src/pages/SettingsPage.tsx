/**
 * User settings — the account page reached from the nav avatar (AppNav). A thin SHELL: it lays out the
 * app chrome and stacks the self-contained setting cards, each of which owns its own form, data and
 * save. Nothing is threaded between them, so a card can be added/removed here with no other changes.
 *
 * The split of concerns across the cards mirrors where each value actually lives:
 *   - AvatarCard / DefaultsCard → OUR backend (profile row): the picture pointer and the default
 *     role/level, via the /api/profile endpoints.
 *   - AccountCard / PasswordCard → SUPABASE AUTH (client-direct): name + email and the password, each
 *     in its own form with its own save, because they're auth-user attributes, not interview data —
 *     the same edge signup and reset use.
 */
import AppNav from "../components/AppNav";
import AvatarCard from "../components/settings/AvatarCard";
import AccountCard from "../components/settings/AccountCard";
import PasswordCard from "../components/settings/PasswordCard";
import DefaultsCard from "../components/settings/DefaultsCard";

export default function SettingsPage() {
    return (
        <div className="min-h-screen bg-bg text-ink">
            <AppNav />

            <div className="mx-auto max-w-[720px] px-7 py-[22px]">
                <h1 className="mt-1.5 font-heading text-[34px] font-medium leading-[1.05]">Settings</h1>

                <div className="mt-6 flex flex-col gap-6">
                    <AvatarCard />
                    <AccountCard />
                    <PasswordCard />
                    <DefaultsCard />
                </div>
            </div>
        </div>
    );
}
