/**
 * Password card — change password in its OWN form, split out from AccountCard so name/email and the
 * password validate and save independently. Client-direct against Supabase Auth (the same edge
 * signup/reset use; no FastAPI hop).
 *
 * We first require + verify the CURRENT password (re-run signInWithPassword: a wrong one errors and we
 * change nothing; a correct one just refreshes the session in place), then set the new password with
 * supabase.auth.updateUser. Password fields always start blank; there's nothing to pre-fill.
 *
 * `isSubmitting` (RHF) is the single busy flag across the verify + the update.
 */
import { useForm } from "react-hook-form";
import { useAuth } from "../../auth/AuthProvider";
import { useToast } from "../../toast/ToastProvider";
import { supabase } from "../../supabase";
import { passwordStrength } from "../../helpers";
import { StrengthMeter } from "../AuthCard";
import Button from "../Button";
import SettingsCard from "./SettingsCard";

type PasswordFields = {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
};

export default function PasswordCard() {
    const { session } = useAuth();
    const { toast } = useToast();
    const currentEmail = session?.user?.email ?? "";
    const {
        register,
        handleSubmit,
        watch,
        reset,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<PasswordFields>({
        defaultValues: {
            currentPassword: "",
            newPassword: "",
            confirmPassword: "",
        },
    });

    const newPassword = watch("newPassword");
    const strength = passwordStrength(newPassword || "");

    async function onSubmit(values: PasswordFields) {
        // 1. Verify the CURRENT password by re-authenticating with it. A wrong password errors here and
        //    we change nothing; a correct one refreshes the session in place (no sign-out).
        const { error: verifyError } = await supabase.auth.signInWithPassword({
            email: currentEmail,
            password: values.currentPassword,
        });
        if (verifyError) {
            setError("currentPassword", { message: "Current password is incorrect." });
            return;
        }

        // 2. Set the new password.
        const { error } = await supabase.auth.updateUser({ password: values.newPassword });
        if (error) {
            setError("root", { message: error.message });
            return;
        }

        // 3. Feedback + clear the fields.
        toast("Password updated", { variant: "success" });
        reset({ currentPassword: "", newPassword: "", confirmPassword: "" });
    }

    return (
        <SettingsCard title="Password" description="Change your sign-in password.">
            <form onSubmit={handleSubmit(onSubmit)} className="mt-5 flex flex-col gap-4">
                <div className="field">
                    <label>Current password</label>
                    <input
                        type="password"
                        className="input"
                        placeholder="Your current password"
                        autoComplete="current-password"
                        {...register("currentPassword", {
                            required: "Enter your current password",
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
                        placeholder="At least 6 characters"
                        autoComplete="new-password"
                        {...register("newPassword", {
                            required: "Enter a new password",
                            minLength: { value: 6, message: "At least 6 characters" },
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
                                value === fv.newPassword || "Passwords do not match",
                        })}
                    />
                    {errors.confirmPassword && (
                        <p className="mt-1 text-[12.5px] text-gap">{errors.confirmPassword.message}</p>
                    )}
                </div>

                {errors.root && (
                    <div className="rounded-md border border-gap-border bg-gap-bg px-3.5 py-[11px] text-[13.5px] leading-[1.45] text-gap">
                        {errors.root.message}
                    </div>
                )}

                <div className="flex justify-end">
                    <Button type="submit" variant="primary" disabled={isSubmitting} className="text-[15px]">
                        {isSubmitting ? "Saving…" : "Update password"}
                    </Button>
                </div>
            </form>
        </SettingsCard>
    );
}
