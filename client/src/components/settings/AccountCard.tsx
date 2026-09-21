/**
 * Account card — name and sign-in email in ONE form, landing in a single supabase.auth.updateUser call
 * (client-direct, the same auth edge signup/reset use; no FastAPI hop). Password lives in its own card
 * (PasswordCard) so the two concerns validate and save independently.
 *
 *   - Name (always sent, idempotent): first_name + last_name, plus the combined display_name kept in
 *     sync (option A — see displayNameFrom) so the dashboard column + initials/greeting keep working.
 *   - Email: included ONLY when it actually changed — Supabase then emails a confirmation link and the
 *     address flips only once the user clicks it (we show a note and don't touch session.user.email).
 *
 * `isSubmitting` (RHF) is the single busy flag across the update.
 */
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "../../auth/AuthProvider";
import { useToast } from "../../toast/ToastProvider";
import { supabase } from "../../supabase";
import { deriveName, displayNameFrom } from "../../helpers";
import Button from "../Button";
import SettingsCard from "./SettingsCard";

type AccountFields = {
    firstName: string;
    lastName: string;
    email: string;
};

export default function AccountCard() {
    const { session } = useAuth();
    const { toast } = useToast();
    const currentEmail = session?.user?.email ?? "";
    const {
        register,
        handleSubmit,
        reset,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<AccountFields>({
        defaultValues: {
            firstName: "",
            lastName: "",
            email: "",
        },
    });

    // The address a confirmation link was just sent to (null = nothing pending) — drives the note below.
    const [sentTo, setSentTo] = useState<string | null>(null);

    // PRE-FILL name + email from the current session, once. Seeded via reset (not defaultValues, which
    // are fixed before the session settles) and guarded by a ref so a background token refresh never
    // clobbers an edit in progress.
    const seeded = useRef(false);
    useEffect(() => {
        if (seeded.current || !session) return;
        const { firstName, lastName } = deriveName(session.user.user_metadata);
        reset({ firstName, lastName, email: currentEmail });
        seeded.current = true;
    }, [session, currentEmail, reset]);

    async function onSubmit(values: AccountFields) {
        const first = values.firstName.trim();
        const last = values.lastName.trim();
        const nextEmail = values.email.trim();
        const emailChanged = nextEmail.toLowerCase() !== currentEmail.toLowerCase();

        // One updateUser. Name is always sent (idempotent); email is added only when it actually changed.
        const attrs: { data: object; email?: string } = {
            data: { first_name: first, last_name: last, display_name: displayNameFrom(first, last) },
        };
        if (emailChanged) attrs.email = nextEmail;

        const { error } = await supabase.auth.updateUser(attrs);
        if (error) {
            setError("root", { message: error.message });
            return;
        }

        toast("Account updated", { variant: "success" });
        setSentTo(emailChanged ? nextEmail : null);
    }

    return (
        <SettingsCard title="Account" description="Your name and sign-in email.">
            <form onSubmit={handleSubmit(onSubmit)} className="mt-5 flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="field">
                        <label>First name</label>
                        <input
                            className="input"
                            placeholder="First name"
                            {...register("firstName", { required: "First name is required" })}
                        />
                        {errors.firstName && (
                            <p className="mt-1 text-[12.5px] text-gap">{errors.firstName.message}</p>
                        )}
                    </div>
                    <div className="field">
                        <label>Last name</label>
                        <input
                            className="input"
                            placeholder="Last name"
                            {...register("lastName", { required: "Last name is required" })}
                        />
                        {errors.lastName && (
                            <p className="mt-1 text-[12.5px] text-gap">{errors.lastName.message}</p>
                        )}
                    </div>
                </div>

                <div className="field">
                    <label>Email</label>
                    <input
                        type="email"
                        className="input"
                        placeholder="you@example.com"
                        {...register("email", {
                            required: "Email is required",
                            pattern: { value: /\S+@\S+\.\S+/, message: "That doesn't look like an email" },
                            onChange: () => setSentTo(null), // editing again clears a stale "sent" note
                        })}
                    />
                    {errors.email && <p className="mt-1 text-[12.5px] text-gap">{errors.email.message}</p>}
                </div>

                {errors.root && (
                    <div className="rounded-md border border-gap-border bg-gap-bg px-3.5 py-[11px] text-[13.5px] leading-[1.45] text-gap">
                        {errors.root.message}
                    </div>
                )}

                {sentTo && (
                    <div className="rounded-md border border-strength-border bg-strength-bg px-3.5 py-[11px] text-[13.5px] leading-[1.45] text-strength">
                        Confirmation link sent to {sentTo}. Your email changes once you confirm from that inbox.
                    </div>
                )}

                <div className="flex justify-end">
                    <Button type="submit" variant="primary" disabled={isSubmitting} className="text-[15px]">
                        {isSubmitting ? "Saving…" : "Save changes"}
                    </Button>
                </div>
            </form>
        </SettingsCard>
    );
}
