/**
 * The ONE writer of the `user` identity slice. Renders nothing — it exists to keep the slice in sync
 * with its two upstream sources: the initials derived from the Supabase session (display name, or
 * email) and the avatar URL from GET /api/profile. Every <UserAvatar> then just selects the result.
 *
 * Mounted inside the AUTHENTICATED subtree only (ProtectedRoute, next to <Outlet/>), so the profile
 * query never fires for a signed-out visitor. When the profile query invalidates after an avatar
 * upload/removal (the Profile tag), `profile` changes, this effect re-runs, and the slice — hence
 * every avatar on screen — updates without any manual refetch or prop plumbing.
 */
import { useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useGetProfileQuery } from "../api";
import { initialsFrom } from "../helpers";
import { setUserIdentity } from "../userSlice";
import { useAppDispatch } from "../store";

export default function IdentitySync() {
    const { session } = useAuth();
    const { data: profile } = useGetProfileQuery();
    const dispatch = useAppDispatch();

    useEffect(() => {
        const initials = initialsFrom(session?.user?.user_metadata?.display_name, session?.user?.email);
        dispatch(setUserIdentity({ initials, avatarUrl: profile?.avatar_url ?? null }));
    }, [session, profile, dispatch]);

    return null;
}
