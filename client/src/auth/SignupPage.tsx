/**
 * Create account — Nocturne mock 4b. Restyled onto the 440px auth card; the FORM LOGIC
 * is unchanged from the pre-redesign page.
 *
 * Logic recap (see git history for the long version): supabase.auth.signUp with the name
 * in options.data (a trigger copies display_name into public.profiles). We capture FIRST +
 * LAST name (option A, matching the settings Name card) and store three keys: first_name,
 * last_name, and the combined display_name the trigger/initials/greeting read — see
 * displayNameFrom. Success has two shapes — data.session set (signed in, navigate home) or
 * null (email confirmation needed, show the check-your-email note). Do not special-case
 * "already registered"; Supabase deliberately returns a normal success so the form can't
 * enumerate accounts.
 *
 * NEW here vs. the old page: the 3-segment strength meter (design element), driven by a
 * trivial score over the live password value.
 */
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { useState } from "react";
import { supabase } from "../supabase";
import { displayNameFrom, passwordStrength } from "../helpers";
import AuthCard, { Brand, StrengthMeter } from "../components/AuthCard";
import Button from "../components/Button";

type SignupFields = {
    email: string;
    password: string;
    confirmPassword: string;
    firstName: string;
    lastName: string;
};

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
        const first = values.firstName.trim();
        const last = values.lastName.trim();
        const { data, error } = await supabase.auth.signUp({
            email: values.email,
            password: values.password,
            options: {
                data: { first_name: first, last_name: last, display_name: displayNameFrom(first, last) },
            },
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
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="field">
                        <label>First name</label>
                        <input
                            className="input"
                            placeholder="First name"
                            {...register("firstName", { required: "First name is required" })}
                        />
                        {errors.firstName && <p className="mt-1 text-[12.5px] text-gap">{errors.firstName.message}</p>}
                    </div>
                    <div className="field">
                        <label>Last name</label>
                        <input
                            className="input"
                            placeholder="Last name"
                            {...register("lastName", { required: "Last name is required" })}
                        />
                        {errors.lastName && <p className="mt-1 text-[12.5px] text-gap">{errors.lastName.message}</p>}
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

                <Button
                    type="submit"
                    variant="primary"
                    block
                    disabled={isSubmitting}
                    className="text-[15px]"
                    style={{ padding: "11px 0" }}
                >
                    {isSubmitting ? "Creating account…" : "Create account"}
                </Button>
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
