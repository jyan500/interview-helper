/**
 * Create account — Nocturne mock 4b. Restyled onto the 440px auth card; the FORM LOGIC
 * is unchanged from the pre-redesign page.
 *
 * Logic recap (see git history for the long version): supabase.auth.signUp with
 * display_name in options.data (a trigger copies it into public.profiles). Success has
 * two shapes — data.session set (signed in, navigate home) or null (email confirmation
 * needed, show the check-your-email note). Do not special-case "already registered";
 * Supabase deliberately returns a normal success so the form can't enumerate accounts.
 *
 * NEW here vs. the old page: the 3-segment strength meter (design element), driven by a
 * trivial score over the live password value.
 */
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { useState } from "react";
import { supabase } from "../supabase";
import AuthCard, { Brand, StrengthMeter } from "../components/AuthCard";

type SignupFields = {
    email: string;
    password: string;
    confirmPassword: string;
    displayName: string;
};

// Trivial local strength score (0–3) for the meter — length, a digit, a symbol/caps mix.
function passwordStrength(pw: string): { score: number; label: string } {
    if (!pw) return { score: 0, label: "" };
    let score = 0;
    if (pw.length >= 10) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw) || (/[a-z]/.test(pw) && /[A-Z]/.test(pw))) score++;
    return { score, label: ["Too short", "Weak", "Fair", "Strong"][score] };
}

export default function SignupPage() {
    const {
        register,
        handleSubmit,
        setError,
        watch,
        formState: { errors, isSubmitting },
    } = useForm<SignupFields>();
    const navigate = useNavigate();
    const [checkEmail, setCheckEmail] = useState(false);

    const strength = passwordStrength(watch("password") || "");

    async function onSubmit(values: SignupFields) {
        const { data, error } = await supabase.auth.signUp({
            email: values.email,
            password: values.password,
            options: { data: { display_name: values.displayName } },
        });
        if (error) {
            setError("root", { message: error.message });
            return;
        }
        if (data.session !== null) {
            navigate("/", { replace: true });
        } else {
            setCheckEmail(true);
        }
    }

    return (
        <AuthCard>
            <Brand />
            <h2 className="mt-[26px] font-heading text-[26px] font-medium tracking-[-0.02em]">
                Create your account
            </h2>
            <p className="mt-2 text-[13.5px] text-neutral-400">
                Your first interview takes about twenty minutes.
            </p>

            <form onSubmit={handleSubmit(onSubmit)} className="mt-6 flex flex-col gap-4">
                <div className="field">
                    <label>Display name</label>
                    <input
                        className="input"
                        placeholder="How the interviewer addresses you"
                        {...register("displayName", { required: "Display name is required" })}
                    />
                    {errors.displayName && <p className="mt-1 text-[12.5px] text-gap">{errors.displayName.message}</p>}
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
                        })}
                    />
                    {errors.email && <p className="mt-1 text-[12.5px] text-gap">{errors.email.message}</p>}
                </div>

                <div className="field">
                    <label>Password</label>
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

                {/* Strength meter — reflects the live password value */}
                <StrengthMeter score={strength.score} label={strength.label} />

                <div className="field">
                    <label>Confirm password</label>
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

                {checkEmail && (
                    <div className="rounded-md border border-strength-border bg-strength-bg px-3.5 py-[11px] text-[13.5px] leading-[1.45] text-strength">
                        Account created — check your email to confirm before signing in.
                    </div>
                )}

                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="btn btn-primary btn-block text-[15px]"
                    style={{ padding: "11px 0" }}
                >
                    {isSubmitting ? "Creating account…" : "Create account"}
                </button>
            </form>

            <p className="mt-[22px] text-[12.5px] leading-[1.5] text-neutral-400">
                By creating an account you agree to the terms and the privacy policy.
            </p>
            <p className="mt-3.5 text-[13.5px] text-neutral-400">
                Already have one?{" "}
                <Link to="/login" className="text-accent-300">
                    Sign in
                </Link>
            </p>
        </AuthCard>
    );
}
