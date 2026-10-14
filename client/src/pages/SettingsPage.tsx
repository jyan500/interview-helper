/**
 * User settings — the account page reached from the nav's account menu. A thin SHELL: it lays out the
 * app chrome and stacks the self-contained setting cards, each of which owns its own form, data and
 * save. Nothing is threaded between them, so a card can be added/removed here with no other changes.
 *
 * Both cards edit SUPABASE AUTH attributes (client-direct): name + email and the password, each in its
 * own form with its own save, the same edge signup and reset use. The picture and the default
 * role/level moved to the Profile page with the rest of the interview-facing profile.
 */
import AppNav from "../components/AppNav";
import AccountCard from "../components/settings/AccountCard";
import PasswordCard from "../components/settings/PasswordCard";

export default function SettingsPage() {
    return (
        <div className="min-h-screen bg-bg text-ink">
            <AppNav />

            <div className="mx-auto max-w-[720px] px-7 py-[22px]">
                <h1 className="mt-1.5 font-heading text-[34px] font-medium leading-[1.05]">Settings</h1>

                <div className="mt-6 flex flex-col gap-6">
                    <AccountCard />
                    <PasswordCard />
                </div>
            </div>
        </div>
    );
}
