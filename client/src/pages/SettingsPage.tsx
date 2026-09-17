/**
 * User settings — for now, the home of the PROFILE PICTURE. Reached from the account avatar in the
 * nav (AppNav). Shares the app chrome (AppNav) and card styling with the dashboard.
 *
 * THE UPLOAD IS CLIENT-DIRECT to Supabase Storage (the one place in the SPA that talks to Supabase for
 * something other than auth — a profile picture isn't interview data, it's a public image, and Storage
 * is the door built for it; see server/db/policies/storage_avatars_bucket.sql). The flow:
 *
 *   pick a file ─► validate ─► supabase.storage.upload(<uid>/avatar) ─► getPublicUrl
 *              ─► PUT /api/profile/avatar { avatar_url } ─► the Profile tag invalidates
 *              ─► IdentitySync re-syncs the `user` slice ─► every <UserAvatar> shows the new picture.
 *
 * The backend only ever STORES the URL (and checks it points at our own bucket); the bytes live in
 * Storage. Removing does the inverse: DELETE the pointer, then best-effort delete the stored object.
 *
 * ONE FLOW FLAG (`busy`) spans the whole save/remove pipeline (upload + the API write), so the buttons
 * lock and can't fire a second, overlapping upload — rather than OR-ing per-step booleans.
 */
import { useEffect, useRef, useState } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../toast/ToastProvider";
import { useDeleteAvatarMutation, useGetProfileQuery, useSetAvatarMutation } from "../api";
import { supabase } from "../supabase";
import { AVATAR_ACCEPTED_TYPES, AVATAR_BUCKET } from "../constants";
import { avatarObjectPath, initialsFrom, validateAvatarFile } from "../helpers";
import AppNav from "../components/AppNav";
import Avatar from "../components/Avatar";
import Button from "../components/Button";

export default function SettingsPage() {
    const { session } = useAuth();
    const { toast } = useToast();
    const { data: profile } = useGetProfileQuery();
    const [setAvatar] = useSetAvatarMutation();
    const [deleteAvatar] = useDeleteAvatarMutation();

    // The chosen-but-unsaved file and its object-URL preview (revoked when it changes / on unmount so
    // the blob doesn't leak). `saving` is the single flow flag for the save/remove pipeline — and, on
    // save, it stays true until the NEW image has actually loaded, not just until the PUT returns.
    const [file, setFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    // The just-saved CDN URL, held only until the profile query refetches to it. It bridges the gap
    // between "PUT returned" and "profile/CDN caught up", so the avatar never flashes back to default.
    const [pendingUrl, setPendingUrl] = useState<string | null>(null);
    // The mirror of pendingUrl for the REMOVE case: after a delete, the profile query still holds the
    // old URL for a beat, so without this the picture lingers after the spinner clears. This suppresses
    // the saved avatar immediately, and clears itself once the refetch confirms avatar_url is null.
    const [justRemoved, setJustRemoved] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        return () => {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        };
    }, [previewUrl]);

    const initials = initialsFrom(session?.user?.user_metadata?.display_name, session?.user?.email);
    // The saved picture, unless we've just removed it (in which case treat it as already gone, ahead of
    // the profile refetch confirming it) — the single source both the preview and the button state read.
    const savedAvatar = justRemoved ? null : profile?.avatar_url ?? null;
    // What the big preview shows, in priority order: the just-picked file, else the just-saved image
    // (while the profile query catches up), else the saved picture, else initials.
    const displayUrl = previewUrl ?? pendingUrl ?? savedAvatar;
    // Whether a picture is saved OR mid-save — includes pendingUrl so the button text ("Choose a
    // different image") and the Remove button don't briefly revert in the gap between the spinner
    // clearing and the profile query refetching to the new URL.
    const hasSavedPicture = Boolean(pendingUrl ?? savedAvatar);

    // After a save produces `pendingUrl`, PRELOAD that exact image; only once it's decoded (or fails)
    // do we drop the local preview and stop the spinner. This is what removes the flash: the picked
    // image stays on screen until the CDN image is ready to take over seamlessly.
    useEffect(() => {
        if (!pendingUrl) return;
        const img = new Image();
        const reveal = () => {
            clearSelection(); // revoke the local preview; displayUrl now resolves to pendingUrl
            setSaving(false);
        };
        img.onload = reveal;
        img.onerror = reveal; // even on error, stop spinning rather than hang
        img.src = pendingUrl;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingUrl]);

    // Once the profile query has refetched to the saved URL, retire `pendingUrl` — displayUrl then
    // resolves to profile.avatar_url (the same URL, already cached), so this is invisible.
    useEffect(() => {
        if (pendingUrl && profile?.avatar_url === pendingUrl) setPendingUrl(null);
    }, [pendingUrl, profile?.avatar_url]);

    // Mirror of the above for removal: once the refetch confirms there's no avatar, drop the optimistic
    // flag (they're now the same state, so this is invisible).
    useEffect(() => {
        if (justRemoved && !profile?.avatar_url) setJustRemoved(false);
    }, [justRemoved, profile?.avatar_url]);

    function clearSelection() {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        setFile(null);
        if (inputRef.current) inputRef.current.value = ""; // let the same file be re-picked later
    }

    function onPick(e: React.ChangeEvent<HTMLInputElement>) {
        const picked = e.target.files?.[0];
        if (!picked) return;
        const error = validateAvatarFile(picked);
        if (error) {
            toast(error, { variant: "error" });
            if (inputRef.current) inputRef.current.value = "";
            return;
        }
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setJustRemoved(false); // picking a new image supersedes a pending removal
        setFile(picked);
        setPreviewUrl(URL.createObjectURL(picked));
    }

    async function onSave() {
        if (!file || !session) return;
        setSaving(true);
        try {
            const path = avatarObjectPath(session.user.id);
            // upsert overwrites the previous picture at the same fixed path (RLS confines writes to
            // this user's <uid>/ folder). contentType so Storage serves the right MIME.
            const { error: uploadError } = await supabase.storage
                .from(AVATAR_BUCKET)
                .upload(path, file, { upsert: true, contentType: file.type });
            if (uploadError) throw uploadError;

            // The public CDN URL, plus a cache-busting ?v= so the browser/CDN don't serve the old
            // image from the reused path. The backend's prefix check ignores the query string.
            const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
            const url = `${data.publicUrl}?v=${Date.now()}`;
            await setAvatar(url).unwrap();

            toast("Profile picture updated", { variant: "success" });
            // Hand off to `pendingUrl` (see the two effects) rather than clearing the preview and
            // spinner here: the profile refetch + the CDN fetch of the new image both take a moment,
            // and dropping the preview now is exactly what flashed the avatar back to default. The
            // spinner stays until the new image has actually loaded.
            setPendingUrl(url);
        } catch {
            toast("Couldn't update your picture. Try again.", { variant: "error" });
            setSaving(false); // failed: stop the spinner, keep the picked file so they can retry
        }
    }

    async function onRemove() {
        setSaving(true);
        try {
            // Clear the POINTER first (the picture disappears from the UI immediately); then best-effort
            // delete the stored object. Doing it in this order means a failed object-delete just leaves a
            // harmless orphan (overwritten on the next upload) rather than a URL pointing at a 404.
            await deleteAvatar().unwrap();
            if (session) {
                await supabase.storage.from(AVATAR_BUCKET).remove([avatarObjectPath(session.user.id)]);
            }
            toast("Profile picture removed", { variant: "success" });
            clearSelection();
            // Hide the picture NOW, without waiting for the profile refetch to report avatar_url=null —
            // otherwise it lingers for a beat after the spinner clears (the effect above resets this).
            setJustRemoved(true);
        } catch {
            toast("Couldn't remove your picture. Try again.", { variant: "error" });
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="min-h-screen bg-bg text-ink">
            <AppNav />

            <div className="mx-auto max-w-[720px] px-7 py-[22px]">
                <h1 className="mt-1.5 font-heading text-[34px] font-medium leading-[1.05]">Settings</h1>

                <div className="mt-6 rounded-md border border-divider px-[22px] pb-[22px] pt-5">
                    <h2 className="font-heading text-[23px] font-medium">Profile picture</h2>

                    <div className="mt-5 flex items-center gap-6">
                        {/* Avatar + a spinner overlay while saving. The overlay (and the pendingUrl
                            bridge behind it) is what masks the upload/refetch latency so the avatar
                            doesn't blink back to the default between "Save" and the image appearing. */}
                        <div className="relative h-28 w-28 flex-none">
                            <Avatar
                                avatarUrl={displayUrl}
                                initials={initials}
                                className="h-full w-full border-neutral-700 text-neutral-300"
                                textClassName="font-heading text-[34px]"
                                alt="Your profile picture"
                            />
                            {saving && (
                                <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/45">
                                    <CircleNotch size={30} className="animate-spin text-accent-300" />
                                </div>
                            )}
                        </div>

                        <div className="flex flex-col gap-3">
                            {/* Hidden native input, driven by the visible button — the standard file-picker
                                pattern so the control matches the app's Button styling. */}
                            <input
                                ref={inputRef}
                                type="file"
                                accept={AVATAR_ACCEPTED_TYPES.join(",")}
                                onChange={onPick}
                                className="hidden"
                            />
                            <div className="flex flex-wrap items-center gap-3">
                                <Button
                                    variant="secondary"
                                    onClick={() => inputRef.current?.click()}
                                    disabled={saving}
                                    className="text-[14px]"
                                >
                                    {hasSavedPicture || file ? "Choose a different image" : "Choose an image"}
                                </Button>
                                {hasSavedPicture && !file && (
                                    <Button
                                        variant="ghost"
                                        onClick={onRemove}
                                        disabled={saving}
                                        className="text-[14px] text-neutral-300 hover:text-accent"
                                    >
                                        Remove
                                    </Button>
                                )}
                            </div>
                            <p className="text-[12px] text-neutral-500">JPEG, PNG, WebP, or GIF, up to 2 MB.</p>
                        </div>
                    </div>

                    {/* Save / cancel appear only once a new file is staged — a preview to confirm before
                        anything is uploaded or stored. */}
                    {file && (
                        <div className="mt-5 flex items-center gap-3 border-t border-divider pt-5">
                            <Button variant="primary" onClick={onSave} disabled={saving} className="text-[15px]">
                                {saving ? "Saving…" : "Save picture"}
                            </Button>
                            <Button variant="secondary" onClick={clearSelection} disabled={saving} className="text-[15px]">
                                Cancel
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
