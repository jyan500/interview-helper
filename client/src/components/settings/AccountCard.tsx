/**
 * Account card — name, email and password in ONE form, all landing in a single
 * supabase.auth.updateUser call (client-direct, the same auth edge signup/reset use; no FastAPI hop).
 * updateUser takes { data, email, password } together, so one Save applies whatever changed:
 *
 *   - Name (always sent, idempotent): first_name + last_name, plus the combined display_name kept in
 *     sync (option A — see displayNameFrom) so the dashboard column + initials/greeting keep working.
 *   - Email: included ONLY when it actually changed — Supabase then emails a confirmation link and the
 *     address flips only once the user clicks it (we show a note and don't touch session.user.email).
 *   - Password: OPTIONAL. Left blank, it's untouched. Filled, we first require + verify the CURRENT
 *     password (re-run signInWithPassword: a wrong one errors and we never change anything; a correct
 *     one just refreshes the session in place), then include the new password in the same updateUser.
 *
 * `isSubmitting` (RHF) is the single busy flag across the verify + the update.
 */
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "../../auth/AuthProvider";
import { useToast } from "../../toast/ToastProvider";
import { supabase } from "../../supabase";
import { deriveName, displayNameFrom, passwordStrength } from "../../helpers";
import { StrengthMeter } from "../AuthCard";
import Button from "../Button";
import SettingsCard from "./SettingsCard";

type AccountFields = {
    firstName: string;
    lastName: string;
    email: string;
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
};

export default function AccountCard() {
    const { session } = useAuth();
    const { toast } = useToast();
    const currentEmail = session?.user?.email ?? "";
    const {
        register,
        handleSubmit,
        watch,
        reset,
        setError,
        resetField,
        formState: { errors, isSubmitting },
    } = useForm<AccountFields>({
        defaultValues: {
            firstName: "",
            lastName: "",
            email: "",
            currentPassword: "",
            newPassword: "",
            confirmPassword: "",
        },
    });

    // The address a confirmation link was just sent to (null = nothing pending) — drives the note below.
    const [sentTo, setSentTo] = useState<string | null>(null);

    // PRE-FILL name + email from the current session, once. Seeded via reset (not defaultValues, which
    // are fixed before the session settles) and guarded by a ref so a background token refresh never
    // clobbers an edit in progress. Password fields always start blank.
    const seeded = useRef(false);
    useEffect(() => {
        if (seeded.current || !session) return;
        const { firstName, lastName } = deriveName(session.user.user_metadata);
        reset({ firstName, lastName, email: currentEmail, currentPassword: "", newPassword: "", confirmPassword: "" });
        seeded.current = true;
    }, [session, currentEmail, reset]);

    const newPassword = watch("newPassword");
    const strength = passwordStrength(newPassword || "");

    async function onSubmit(values: AccountFields) {
        const first = values.firstName.trim();
        const last = values.lastName.trim();
        const nextEmail = values.email.trim();
        const emailChanged = nextEmail.toLowerCase() !== currentEmail.toLowerCase();
        const changingPassword = values.newPassword.length > 0;

        // 1. If the password is changing, verify the CURRENT one first by re-authenticating with it. A
        //    wrong password errors here and we change nothing; a correct one refreshes the session in
        //    place (no sign-out). Skipped entirely when the password fields are left blank.
        if (changingPassword) {
            const { error: verifyError } = await supabase.auth.signInWithPassword({
                email: currentEmail,
                password: values.currentPassword,
            });
            if (verifyError) {
                setError("currentPassword", { message: "Current password is incorrect." });
                return;
            }
        }

        // 2. One updateUser with everything that changed. Name is always sent (idempotent); email and
        //    password are added only when they actually change.
        const attrs: { data: object; email?: string; password?: string } = {
            data: { first_name: first, last_name: last, display_name: displayNameFrom(first, last) },
        };
        if (emailChanged) attrs.email = nextEmail;
        if (changingPassword) attrs.password = values.newPassword;

        const { error } = await supabase.auth.updateUser(attrs);
        if (error) {
            setError("root", { message: error.message });
            return;
        }

        // 3. Feedback. Clear the password fields (name/email stay as entered); surface the email
        //    confirmation note when the address changed.
        toast("Account updated", { variant: "success" });
        resetField("currentPassword");
        resetField("newPassword");
        resetField("confirmPassword");
        setSentTo(emailChanged ? nextEmail : null);
    }

    return (
        <SettingsCard title="Account" description="Your name, sign-in email, and password.">
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

                {/* Password — optional. The whole group is skipped unless a new password is typed. */}
                <div className="mt-1 border-t border-divider pt-4">
                    <p className="text-[13px] text-neutral-400">
                        Change password — leave blank to keep your current one.
                    </p>

                    <div className="mt-4 flex flex-col gap-4">
                        <div className="field">
                            <label>Current password</label>
                            <input
                                type="password"
                                className="input"
                                placeholder="Required only to change your password"
                                autoComplete="current-password"
                                {...register("currentPassword", {
                                    validate: (value, fv) =>
                                        !fv.newPassword ||
                                        value.trim().length > 0 ||
                                        "Enter your current password to set a new one",
                                })}
                            />
                            {errors.currentPassword && (
                                <p className="mt-1 text-[12.5px] text-gap">{errors.currentPassword.message}</p>
                            )}
                        </div>

                        <div className="field">
                            <label>New password</label>
                            <input
                                type="password"
                                className="input"
                                placeholder="At least 10 characters"
                                autoComplete="new-password"
                                {...register("newPassword", {
                                    validate: (value) =>
                                        value === "" || value.length >= 6 || "At least 6 characters",
                                })}
                            />
                            {errors.newPassword && (
                                <p className="mt-1 text-[12.5px] text-gap">{errors.newPassword.message}</p>
                            )}
                        </div>

                        {/* Only shown once they've started a new password — no meter for an empty field. */}
                        {newPassword && <StrengthMeter score={strength.score} label={strength.label} />}

                        <div className="field">
                            <label>Confirm new password</label>
                            <input
                                type="password"
                                className="input"
                                placeholder="Repeat your new password"
                                autoComplete="new-password"
                                {...register("confirmPassword", {
                                    validate: (value, fv) =>
                                        !fv.newPassword ||
                                        value === fv.newPassword ||
                                        "Passwords do not match",
                                })}
                            />
                            {errors.confirmPassword && (
                                <p className="mt-1 text-[12.5px] text-gap">{errors.confirmPassword.message}</p>
                            )}
                        </div>
                    </div>
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
