/**
 * WORKED EXAMPLE — sign in, with react-hook-form doing the form state.
 *
 * WHAT react-hook-form BUYS YOU. The useState version of this page is two more state
 * variables per field, an onChange per input, a manual validity check, and a submitting
 * flag. Here: `register` wires an input to the form, `handleSubmit` validates and only then
 * calls your handler, and `formState` hands back errors and `isSubmitting`. It keeps values
 * in refs rather than state, so typing in one field doesn't re-render the whole form.
 *
 * TWO KINDS OF ERROR, AND THEY LIVE IN THE SAME PLACE:
 *
 *      errors.email    a FIELD error — the rules in register() failed, no network involved
 *      errors.root     a FORM error — the server rejected the whole attempt ("Invalid login
 *                      credentials"). "root" is react-hook-form's reserved key for exactly
 *                      this; you set it yourself with setError.
 *
 * WHAT THIS PAGE DOES *NOT* DO: it never touches AuthProvider, never sets a session, never
 * stores a token. `signInWithPassword` succeeds -> supabase-js stores the session and fires
 * onAuthStateChange -> the provider's mirror updates -> <ProtectedRoute> re-renders and lets
 * you through. This page only navigates. If you find yourself wanting to setSession()
 * anywhere, the mirror has grown a second writer and will start to drift.
 */
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router";
import { supabase } from "../supabase";

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

    // Where to go after a successful sign-in. <ProtectedRoute> stashes the page you were
    // trying to reach in navigation state, so being bounced to /login and back is invisible.
    const from = (location.state as { from?: string } | null)?.from ?? "/";

    async function onSubmit(values: LoginFields) {
        // supabase-js returns errors in the RESULT, it does not throw — so there's no
        // try/catch here. Forgetting this is how you end up with a login page that silently
        // does nothing on a wrong password.
        const { error } = await supabase.auth.signInWithPassword({
            email: values.email,
            password: values.password,
        });

        if (error) {
            setError("root", { message: error.message });
            return;
        }

        // `replace: true` so the browser Back button doesn't return to the login page of a
        // session that's now signed in.
        navigate(from, { replace: true });
    }

    return (
        <main className="mx-auto max-w-sm p-6 font-sans">
            <h1 className="mb-4 text-2xl font-bold text-slate-800">Sign in</h1>

            {/* handleSubmit(onSubmit) runs validation FIRST and calls onSubmit only if it
                passes — which is why onSubmit can assume `values` is well-formed. */}
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
                <div>
                    <label className="block text-sm font-medium text-slate-700">Email</label>
                    {/* register() returns {name, onChange, onBlur, ref} — spreading it is what
                        connects this input to the form. The second argument is the rule set. */}
                    <input
                        type="email"
                        {...register("email", {
                            required: "Email is required",
                            pattern: { value: /\S+@\S+\.\S+/, message: "That doesn't look like an email" },
                        })}
                        className="mt-1 w-full rounded-md border border-slate-300 p-2 focus:border-slate-500 focus:outline-none"
                    />
                    {errors.email && (
                        <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
                    )}
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700">Password</label>
                    <input
                        type="password"
                        {...register("password", {
                            required: "Password is required",
                            // Matches Supabase's own default minimum, so the browser catches
                            // it before the round-trip. Raising it here does NOT raise it at
                            // Supabase — that's a dashboard setting (Authentication -> Policies).
                            minLength: { value: 6, message: "At least 6 characters" },
                        })}
                        className="mt-1 w-full rounded-md border border-slate-300 p-2 focus:border-slate-500 focus:outline-none"
                    />
                    {errors.password && (
                        <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
                    )}
                </div>

                {/* the FORM-level error — whatever Supabase said. */}
                {errors.root && (
                    <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{errors.root.message}</p>
                )}

                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full rounded-md bg-slate-800 px-4 py-2 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
                >
                    {isSubmitting ? "Signing in…" : "Sign in"}
                </button>
            </form>

            <p className="mt-4 text-sm text-slate-600">
                No account? <Link to="/signup" className="font-medium underline">Sign up</Link>
            </p>
        </main>
    );
}
