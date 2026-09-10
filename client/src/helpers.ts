/**
 * Small, dependency-free UI helpers shared across pages. Pure functions only — no React, no
 * network, no module state — so they're trivial to reuse and to reason about.
 */
import { IGNORED_INTERVIEWS_STORAGE_KEY, MIC_DEVICE_STORAGE_KEY } from "./constants";

/**
 * Two-letter initials for an avatar, derived from a display name or, failing that, an email.
 *   "Jane Yan"        -> "JY"   (first letter of the first two words)
 *   "jyan500@..."     -> "JY"   (first two characters, when there's only one token)
 *   "" / undefined    -> "You"  (never render a blank avatar)
 */
export function initialsFrom(name?: string, email?: string): string {
    const src = (name || email || "").trim();
    if (!src) return "You";
    const parts = src.split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return src.slice(0, 2).toUpperCase();
}

/**
 * The candidate's chosen microphone, persisted so it survives across interviews and becomes the DEFAULT
 * the next session opens with (see MIC_DEVICE_STORAGE_KEY) — the reason a mic picked in the Settings
 * modal takes effect immediately next time instead of "not until a turn passes". A missing value falls
 * back to "" (system default); the stored value is a MediaDeviceInfo.deviceId.
 */
export function loadStoredMicDeviceId(): string {
    return localStorage.getItem(MIC_DEVICE_STORAGE_KEY) ?? "";
}

export function saveStoredMicDeviceId(deviceId: string): void {
    localStorage.setItem(MIC_DEVICE_STORAGE_KEY, deviceId);
}

/**
 * The interview ids the user has "Ignore"d on the resume banner (see IGNORED_INTERVIEWS_STORAGE_KEY).
 * Stored as a JSON array of slugs; a malformed/missing value reads as an empty list. Ignoring hides
 * the banner for THAT interview only — it stays resumable, and a newer unfinished one still shows.
 */
export function loadIgnoredInterviewIds(): string[] {
    const raw = localStorage.getItem(IGNORED_INTERVIEWS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
}

export function addIgnoredInterviewId(interviewId: string): void {
    const ids = loadIgnoredInterviewIds();
    if (ids.includes(interviewId)) return;
    localStorage.setItem(IGNORED_INTERVIEWS_STORAGE_KEY, JSON.stringify([...ids, interviewId]));
}
