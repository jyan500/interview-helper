/**
 * Set a new password — Nocturne mock 4c (third card). Reached from the emailed reset
 * link: Supabase puts a recovery session in place when the user lands here, so
 * supabase.auth.updateUser({ password }) is all that's needed.
 *
 * DESIGN + light wiring: the strength meter is presentational; the submit is wired to
 * updateUser and navigates home on success.
 */
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { supabase } from "../supabase";
import AuthCard, { StrengthMeter } from "../components/AuthCard";

type Fields = { password: string; confirmPassword: string };

function passwordStrength(pw: string): { score: number; label: string } {
    if (!pw) return { score: 0, label: "" };
    let score = 0;
    if (pw.length >= 10) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw) || (/[a-z]/.test(pw) && /[A-Z]/.test(pw))) score++;
    return { score, label: ["Too short", "Weak", "Fair", "Strong"][score] };
}

export default function ResetPasswordPage() {
    const {
        register,
        handleSubmit,
        watch,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<Fields>();
    const navigate = useNavigate();

    const strength = passwordStrength(watch("password") || "");

    async function onSubmit(values: Fields) {
        const { error } = await supabase.auth.updateUser({ password: values.password });
        if (error) {
            setError("root", { message: error.message });
            return;
        }
        navigate("/", { replace: true });
    }

    return (
        <AuthCard>
            <div className="kicker">From the link</div>
            <h2 className="mt-3.5 font-heading text-[24px] font-medium tracking-[-0.02em]">Set a new password</h2>

            <form onSubmit={handleSubmit(onSubmit)} className="mt-[22px] flex flex-col gap-4">
                <div className="field">
                    <label>New password</label>
                    <input
                        type="password"
                        className="input"
                        placeholder="At least 10 characters"
                        {...register("password", {
                            required: "Password is required",
                            minLength: { value: 6, message: "At least 6 characters" },
                        })}
                    />
                    {errors.password && <p className="mt-1 text-[12.5px] text-gap">{errors.password.message}</p>}
                </div>

                <StrengthMeter score={strength.score} label={strength.label} />

                <div className="field">
                    <label>Confirm new password</label>
                    <input
                        type="password"
                        className="input"
                        placeholder="Repeat your password"
                        {...register("confirmPassword", {
                            required: "Confirm password is required",
                            validate: (value, formValues) =>
                                value === formValues.password || "Passwords do not match",
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

                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="btn btn-primary btn-block text-[15px]"
                    style={{ padding: "11px 0" }}
                >
                    {isSubmitting ? "Saving…" : "Save and sign in"}
                </button>
            </form>
        </AuthCard>
    );
}
