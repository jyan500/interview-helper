/**
 * Sign in — Nocturne mock 4a. A split panel: marketing on the left, the form on the
 * right. The FORM LOGIC is unchanged from the pre-redesign page (react-hook-form +
 * supabase.auth.signInWithPassword); only the presentation is new.
 *
 * react-hook-form recap: `register` wires an input, `handleSubmit` validates then calls
 * onSubmit, `errors.email` is a field error, `errors.root` is the form-level error we set
 * ourselves from Supabase's message. This page only navigates — it never sets a session;
 * signInWithPassword succeeding fires onAuthStateChange, which updates AuthProvider's
 * mirror and lets ProtectedRoute through.
 *
 * The social buttons are DESIGN ONLY (no OAuth wired) — TODO(wire).
 */
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router";
import { supabase } from "../supabase";
import { Brand } from "../components/AuthCard";

type LoginFields = {
    email: string;
    password: string;
};

export default function LoginPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<LoginFields>();

    const from = (location.state as { from?: string } | null)?.from ?? "/";

    async function onSubmit(values: LoginFields) {
        const { error } = await supabase.auth.signInWithPassword({
            email: values.email,
            password: values.password,
        });
        if (error) {
            setError("root", { message: error.message });
            return;
        }
        navigate(from, { replace: true });
    }

    const hasError = !!errors.root;

    return (
        <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
            <div className="grid h-[720px] max-h-full w-[1180px] max-w-full grid-cols-1 overflow-hidden rounded-md bg-bg shadow-lg md:grid-cols-[1fr_440px]">
                {/* ── Left marketing panel ─────────────────────────────────────── */}
                <div
                    className="hidden flex-col p-12 md:flex"
                    style={{ background: "radial-gradient(120% 100% at 8% 0%, #1c1f31 0%, var(--color-bg) 62%)" }}
                >
                    <Brand size={19} />
                    <div className="mt-auto max-w-[460px]">
                        <h1 className="font-heading text-[40px] font-medium leading-[1.1] tracking-[-0.025em] [text-wrap:pretty]">
                            Practise the interview before it counts.
                        </h1>
                        <p className="mt-4 text-[15px] leading-[1.6] text-neutral-300 [text-wrap:pretty]">
                            Pick a role and level, talk or type your way through a real interview, and get a scorecard
                            with the gaps named.
                        </p>
                        <div className="mt-[30px] flex flex-col gap-3 text-sm text-neutral-300">
                            {[
                                "Questions drawn from the role you are targeting",
                                "Switch between voice and text mid-session",
                                "Every transcript kept, scored on four criteria",
                            ].map((line) => (
                                <div key={line} className="flex items-center gap-[11px]">
                                    <span className="h-[5px] w-[5px] flex-none rounded-full bg-accent" />
                                    {line}
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="mt-auto pt-[34px] text-[12.5px] text-neutral-400">
                        Transcripts stay in your account. Nothing is shared.
                    </div>
                </div>

                {/* ── Right form column ────────────────────────────────────────── */}
                <div className="flex flex-col justify-center border-divider p-10 md:border-l">
                    <h2 className="font-heading text-[26px] font-medium tracking-[-0.02em]">Sign in</h2>
                    <p className="mt-2 text-[13.5px] text-neutral-400">Welcome back.</p>

                    <form onSubmit={handleSubmit(onSubmit)} className="mt-[26px] flex flex-col gap-4">
                        {/* Form-level error — the Gap-colored banner from mock 4b */}
                        {hasError && (
                            <div className="rounded-md border border-gap-border bg-gap-bg px-3.5 py-[11px] text-[13.5px] leading-[1.45] text-gap">
                                {errors.root?.message}
                            </div>
                        )}

                        <div className="field">
                            <label>Email</label>
                            <input
                                type="email"
                                className="input"
                                style={hasError ? { borderColor: "var(--color-gap-border)" } : undefined}
                                {...register("email", {
                                    required: "Email is required",
                                    pattern: { value: /\S+@\S+\.\S+/, message: "That doesn't look like an email" },
                                })}
                            />
                            {errors.email && <p className="mt-1 text-[12.5px] text-gap">{errors.email.message}</p>}
                        </div>

                        <div className="field">
                            <div className="flex items-baseline justify-between">
                                <label className="mb-0">Password</label>
                                <Link to="/forgot-password" className="text-[12.5px] text-accent-300">
                                    Forgot?
                                </Link>
                            </div>
                            <input
                                type="password"
                                className="input mt-[5px]"
                                style={hasError ? { borderColor: "var(--color-gap-border)" } : undefined}
                                {...register("password", {
                                    required: "Password is required",
                                    minLength: { value: 6, message: "At least 6 characters" },
                                })}
                            />
                            {errors.password && <p className="mt-1 text-[12.5px] text-gap">{errors.password.message}</p>}
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="btn btn-primary btn-block text-[15px]"
                            style={{ padding: "11px 0" }}
                        >
                            {isSubmitting ? "Signing in…" : "Sign in"}
                        </button>
                    </form>

                    {/* "or" divider */}
                    <div className="my-6 flex items-center gap-3">
                        <span className="h-px flex-1 bg-divider" />
                        <span className="text-[12px] text-neutral-400">or</span>
                        <span className="h-px flex-1 bg-divider" />
                    </div>

                    {/* Social sign-in — DESIGN ONLY (TODO(wire): supabase OAuth) */}
                    <div className="flex flex-col gap-2.5">
                        <button className="btn btn-secondary btn-block text-sm" style={{ padding: "10px 0" }}>
                            Continue with Google
                        </button>
                        <button className="btn btn-secondary btn-block text-sm" style={{ padding: "10px 0" }}>
                            Continue with GitHub
                        </button>
                    </div>

                    <p className="mt-[26px] text-[13.5px] text-neutral-400">
                        No account?{" "}
                        <Link to="/signup" className="text-accent-300">
                            Create one
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
