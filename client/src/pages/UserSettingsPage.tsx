/**
 * User settings (/settings/user) — the account page reached from the nav's account menu. A thin SHELL:
 * it stacks the self-contained setting cards, each of which owns its own form, data and save. Nothing is
 * threaded between them, so a card can be added/removed here with no other changes.
 *
 * Both cards edit SUPABASE AUTH attributes (client-direct): name + email and the password, each in its
 * own form with its own save, the same edge signup and reset use. The picture and the default
 * role/level moved to the Profile page with the rest of the interview-facing profile.
 *
 * The app nav and the sidebar (Profile / User settings / Interview settings) come from SettingsLayout.
 */
import AccountCard from "../components/settings/AccountCard";
import PasswordCard from "../components/settings/PasswordCard";

export default function UserSettingsPage() {
    return (
        <>
            <h1 className="mt-1.5 font-heading text-[34px] font-medium leading-[1.05]">User settings</h1>

            <div className="mt-6 flex flex-col gap-6">
                <AccountCard />
                <PasswordCard />
            </div>
        </>
    );
}
