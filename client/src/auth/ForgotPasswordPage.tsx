/**
 * Forgot password — Nocturne mock 4c (request + "check your email"). New flow.
 *
 * The request is wired to supabase.auth.resetPasswordForEmail (redirecting back to
 * /reset-password); on success we swap to the "check your email" state. The actual
 * new-password step lives on ResetPasswordPage, reached from the emailed link.
 */
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { useState } from "react";
import { supabase } from "../supabase";
import AuthCard, { Brand } from "../components/AuthCard";

type Fields = { email: string };

export default function ForgotPasswordPage() {
    const {
        register,
        handleSubmit,
        getValues,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<Fields>();
    const [sent, setSent] = useState(false);

    async function onSubmit(values: Fields) {
        const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
            redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) {
            setError("root", { message: error.message });
            return;
        }
        setSent(true);
    }

    // ── "Check your email" state ──────────────────────────────────────────────
    if (sent) {
        return (
            <AuthCard>
                <div className="kicker">Link sent</div>
                <h2 className="mt-3.5 font-heading text-[24px] font-medium tracking-[-0.02em]">
                    Check your email
                </h2>
                <p className="mt-2.5 text-[14px] leading-[1.55] text-neutral-300 [text-wrap:pretty]">
                    We sent a reset link to <span className="text-ink">{getValues("email")}</span>. It expires in 30
                    minutes.
                </p>
                <div className="mt-[22px] flex gap-2">
                    <button className="btn btn-secondary text-[13.5px]" onClick={() => onSubmit(getValues())}>
                        Resend link
                    </button>
                    <button className="btn btn-ghost text-[13.5px]" onClick={() => setSent(false)}>
                        Use a different email
                    </button>
                </div>
            </AuthCard>
        );
    }

    // ── Request state ─────────────────────────────────────────────────────────
    return (
        <AuthCard>
            <Brand />
            <h2 className="mt-[26px] font-heading text-[26px] font-medium tracking-[-0.02em]">
                Reset your password
            </h2>
            <p className="mt-2 text-[13.5px] leading-[1.5] text-neutral-400">
                Enter the email on your account and we will send a link to set a new password.
            </p>

            <form onSubmit={handleSubmit(onSubmit)} className="mt-6 flex flex-col gap-4">
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
                    {isSubmitting ? "Sending…" : "Send reset link"}
                </button>
            </form>

            <p className="mt-[22px] text-[13.5px] text-neutral-400">
                <Link to="/login" className="text-accent-300">
                    Back to sign in
                </Link>
            </p>
        </AuthCard>
    );
}
