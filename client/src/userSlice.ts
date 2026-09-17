/**
 * The current user's DISPLAY IDENTITY — only what an avatar needs: their initials (the fallback) and
 * their uploaded picture URL (or null). It lives in Redux so every <UserAvatar> reads it with a
 * selector instead of the value being prop-drilled through the session/transcript component trees
 * (which is exactly what it was before this slice).
 *
 * It MIRRORS two upstream sources — `initials` derived from the Supabase session, `avatarUrl` from the
 * GET /api/profile query — and is written in ONE place: <IdentitySync>, mounted once in the
 * authenticated subtree (ProtectedRoute). Nothing else dispatches here. When the profile query
 * invalidates after an upload/removal, the sync re-runs and every avatar on screen updates at once.
 * Same single-owner instinct as the rest of the app: one writer, everyone else selects.
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface UserIdentityState {
    initials: string;
    avatarUrl: string | null;
}

// "You" is the same neutral placeholder initialsFrom() falls back to, so an avatar rendered before the
// sync's first dispatch (a frame, at most) shows nothing jarring.
const initialState: UserIdentityState = { initials: "You", avatarUrl: null };

const userSlice = createSlice({
    name: "user",
    initialState,
    reducers: {
        setUserIdentity(state, action: PayloadAction<UserIdentityState>) {
            state.initials = action.payload.initials;
            state.avatarUrl = action.payload.avatarUrl;
        },
    },
});

export const { setUserIdentity } = userSlice.actions;
export default userSlice.reducer;
