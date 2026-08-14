/**
 * SCAFFOLD — sign up. Deliberately close to LoginPage, so copy that and change what differs.
 *
 * Read LoginPage.tsx first; everything about register/handleSubmit/errors.root is identical
 * and isn't re-explained here. THREE things are genuinely different:
 *
 * 1. `signUp` INSTEAD OF `signInWithPassword`, and it takes a third thing — user metadata:
 *
 *        const { data, error } = await supabase.auth.signUp({
 *            email, password,
 *            options: { data: { display_name: values.displayName } },
 *        });
 *
 *    THAT `data` OBJECT IS NOT DECORATION, and it's the nicest connection in this phase:
 *    it lands in `auth.users.raw_user_meta_data`, and the signup TRIGGER you wrote back in
 *    migration 3bf1a2d6fb29 reads exactly that key:
 *
 *        INSERT INTO public.profiles (id, display_name)
 *        VALUES (NEW.id, NEW.raw_user_meta_data ->> 'display_name')
 *
 *    So a name typed in this form ends up in YOUR profiles table without your API being
 *    involved at all. The key must match the trigger's string exactly — `display_name`.
 *    (It's nullable, so omitting the field entirely still signs people up fine.)
 *
 * 2. SUCCESS HAS TWO SHAPES, and this is the one that confuses everyone:
 *
 *        data.session !== null   ->  signed in immediately. Navigate to "/" like login does.
 *        data.session === null   ->  the account exists but needs EMAIL CONFIRMATION.
 *                                    There is no session, so navigating anywhere protected
 *                                    just bounces to /login. Render "check your email" instead.
 *
 *    Which one you get is a project setting, not a code path you control: Supabase dashboard
 *    -> Authentication -> Sign In / Providers -> "Confirm email". ON is the default and the
 *    right production posture. While building, turning it OFF makes the loop much faster —
 *    just remember it's off, or you'll wonder why prod behaves differently. Handle BOTH
 *    branches either way; the setting can change under you.
 *
 * 3. A THIRD FIELD to register (`displayName`), plus — if you want it — the classic
 *    confirm-password rule, which is where react-hook-form's `validate` earns its keep:
 *
 *        validate: (value, formValues) =>
 *            value === formValues.password || "Passwords don't match"
 *
 * TODO — build the page:
 *   - type SignupFields = { email: string; password: string; displayName: string }
 *   - useForm<SignupFields>(), same destructure as LoginPage (add `getValues` if you do the
 *     confirm-password field)
 *   - the three inputs with their rules; mirror LoginPage's markup so the two pages match
 *   - onSubmit: call signUp; on `error` -> setError("root", { message: error.message });
 *     on success -> branch on `data.session` as above. For the confirmation branch, a piece
 *     of local state (`const [checkEmail, setCheckEmail] = useState(false)`) that swaps the
 *     form for a message is plenty — no route needed.
 *   - a <Link to="/login"> for people who already have an account
 *
 * ONE THING NOT TO BUILD: a check for "is this email already registered". Supabase
 * deliberately returns a normal-looking success for an existing address (it just doesn't
 * create anything) so that a signup form can't be used to enumerate who has an account.
 * If you special-case it, you've rebuilt the leak.
 */
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { supabase } from "../supabase";
import { useState } from "react"

type SignupFields = {
    email: string;
    password: string;
    confirmPassword: string;
    displayName: string;
};

export default function SignupPage() {

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<SignupFields>();
    const navigate = useNavigate()
    const [checkEmail, setCheckEmail ] = useState(false)

    async function onSubmit(values: SignupFields){
        const { data, error } = await supabase.auth.signUp(
        {
             email: values.email, 
             password: values.password,
             options: { data: { display_name: values.displayName } },
        }
        );

        if (error) {
            setError("root", { message: error.message });
            return;
        }

        if (data.session !== null){
            navigate("/", {replace: true})
        }

        else {
            setCheckEmail(true)
        }

    }

    return (
        <main className="mx-auto max-w-sm p-6 font-sans">
            <h1 className="mb-4 text-2xl font-bold text-slate-800">Sign up</h1>
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
                        <label className="block text-sm font-medium text-slate-700">Display Name</label>
                        {/* register() returns {name, onChange, onBlur, ref} — spreading it is what
                            connects this input to the form. The second argument is the rule set. */}
                        <input
                            type="text"
                            {...register("displayName", {
                                required: "Display Name is required",
                            })}
                            className="mt-1 w-full rounded-md border border-slate-300 p-2 focus:border-slate-500 focus:outline-none"
                        />
                        {errors.displayName && (
                            <p className="mt-1 text-sm text-red-600">{errors.displayName.message}</p>
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


                    <div>
                        <label className="block text-sm font-medium text-slate-700">Confirm Password</label>
                        <input
                            type="password"
                            {...register("confirmPassword", {
                                required: "Confirm Password is required",
                                // Matches Supabase's own default minimum, so the browser catches
                                // it before the round-trip. Raising it here does NOT raise it at
                                // Supabase — that's a dashboard setting (Authentication -> Policies).
                                minLength: { value: 6, message: "At least 6 characters" },
                                validate: (value, formValues) => value === formValues.password || "Passwords do not match"
                            })}
                            className="mt-1 w-full rounded-md border border-slate-300 p-2 focus:border-slate-500 focus:outline-none"
                        />
                        {errors.confirmPassword && (
                            <p className="mt-1 text-sm text-red-600">{errors.confirmPassword.message}</p>
                        )}
                    </div>

                   
                    {/* the FORM-level error — whatever Supabase said. */}
                    {errors.root && (
                        <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{errors.root.message}</p>
                    )}

                    {
                        checkEmail && (
                            <p className="rounded-md bg-green-50 p-2 text-sm text-green-700">Please check your email for confirmation</p>
                        )
                    }

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full rounded-md bg-slate-800 px-4 py-2 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
                    >
                        {isSubmitting ? "Signing up..." : "Signup"}
                    </button>
                </form>
            <p className="mt-4 text-sm text-slate-600">
                Already have an account? <Link to="/login" className="font-medium underline">Sign in</Link>
            </p>
        </main>
    );
}
