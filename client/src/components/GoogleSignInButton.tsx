/**
 * "Continue with Google" — Supabase OAuth. Used on both the sign-in and sign-up pages: there is no
 * separate Google sign-UP, the first Google sign-in creates the account (and the profile-row trigger
 * creates its profile).
 *
 * The flow, none of which this component has to manage:
 *   1. signInWithOAuth navigates the whole tab to Google's consent screen.
 *   2. Google -> Supabase's /auth/v1/callback -> back to `redirectTo` with the session in the URL.
 *   3. supabase-js (detectSessionInUrl) picks the session up on load and fires onAuthStateChange;
 *      AuthProvider's getSession() waits for that, so ProtectedRoute lets us straight in.
 *
 * `redirectPath` is where to land afterwards (the login page passes its "return to where you were"
 * path). It's built on window.location.origin, so localhost and prod need no config here; the origin
 * just has to be on Supabase's Redirect URLs allowlist.
 *
 * `redirecting` is the single busy flag: set on click, only cleared if Supabase errors before leaving
 * (on success the page navigates away, so there's nothing to clear).
 */
import { useState } from "react";
import { GoogleLogo } from "@phosphor-icons/react";
import { supabase } from "../supabase";
import { useToast } from "../toast/ToastProvider";
import Button from "./Button";

export default function GoogleSignInButton({ redirectPath = "/" }: { redirectPath?: string }) {
    const { toast } = useToast();
    const [redirecting, setRedirecting] = useState(false);

    async function onClick() {
        setRedirecting(true);
        const { error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: `${window.location.origin}${redirectPath}` },
        });
        if (error) {
            setRedirecting(false);
            toast(error.message, { variant: "error" });
        }
    }

    return (
        <Button
            variant="secondary"
            block
            disabled={redirecting}
            onClick={onClick}
            className="inline-flex items-center justify-center gap-2 text-sm"
            style={{ padding: "10px 0" }}
        >
            <GoogleLogo size={16} weight="bold" />
            {redirecting ? "Redirecting to Google…" : "Continue with Google"}
        </Button>
    );
}
