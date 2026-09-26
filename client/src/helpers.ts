/**
 * Small, dependency-free UI helpers shared across pages. Pure functions only — no React, no
 * network, no module state — so they're trivial to reuse and to reason about.
 */
import type { SelectOption } from "./components/AsyncPaginateSelect";
import type { BasePageItem } from "./api";
import {
    AVATAR_ACCEPTED_TYPES,
    AVATAR_MAX_BYTES,
    CODE_LANGUAGE_STORAGE_KEY,
    CODE_LANGUAGES,
    DEFAULT_CODE_LANGUAGE,
    DEFAULT_EDITOR_SETTINGS,
    EDITOR_FONT_SIZES,
    EDITOR_KEYMAPS,
    EDITOR_SETTINGS_STORAGE_KEY,
    IGNORED_INTERVIEWS_STORAGE_KEY,
    MIC_DEVICE_STORAGE_KEY,
    type CodeLanguage,
    type EditorSettings,
} from "./constants";

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
 * The Storage object path for a user's avatar: `<uid>/avatar`. The FIRST path segment is the auth
 * uid, which is exactly what the bucket's RLS policies compare against (they only permit a write
 * where `(storage.foldername(name))[1] = auth.uid()`), so this is what confines an upload to the
 * user's own folder. One fixed name per user (upsert overwrites the previous picture) — cache-busting
 * is done on the URL, not by unique filenames (which would leave orphans).
 */
export function avatarObjectPath(uid: string): string {
    return `${uid}/avatar`;
}

/**
 * Pre-flight validation for a chosen avatar file — returns a human error string, or null when the
 * file is acceptable. A courtesy check before we hand the file to Storage: the wrong type or an
 * oversized image is caught here with a clear message instead of a raw Storage error. The real
 * limits are the bucket's; these just mirror them (AVATAR_ACCEPTED_TYPES / AVATAR_MAX_BYTES).
 */
export function validateAvatarFile(file: File): string | null {
    if (!AVATAR_ACCEPTED_TYPES.includes(file.type)) {
        return "Please choose a JPEG, PNG, WebP, or GIF image.";
    }
    if (file.size > AVATAR_MAX_BYTES) {
        return `That image is too large. Keep it under ${Math.round(AVATAR_MAX_BYTES / (1024 * 1024))} MB.`;
    }
    return null;
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
 * The coding panel's language, persisted so the next coding round opens in the one last used. An
 * unknown or missing value falls back to the default.
 */
export function loadStoredCodeLanguage(): CodeLanguage {
    const stored = localStorage.getItem(CODE_LANGUAGE_STORAGE_KEY);
    return CODE_LANGUAGES.find((l) => l.value === stored)?.value ?? DEFAULT_CODE_LANGUAGE;
}

export function saveStoredCodeLanguage(language: CodeLanguage): void {
    localStorage.setItem(CODE_LANGUAGE_STORAGE_KEY, language);
}

/**
 * The coding editor's preferences, persisted as one JSON blob. Each field is validated on its own
 * against the allowed values, so a stale or hand-edited blob keeps what's still valid and falls back
 * to the default for the rest, instead of dropping everything.
 */
export function loadStoredEditorSettings(): EditorSettings {
    const raw = localStorage.getItem(EDITOR_SETTINGS_STORAGE_KEY);
    const stored: Partial<EditorSettings> = raw ? JSON.parse(raw) : {};
    const d = DEFAULT_EDITOR_SETTINGS;
    return {
        fontSize: EDITOR_FONT_SIZES.find((s) => s.value === stored.fontSize)?.value ?? d.fontSize,
        keymap: EDITOR_KEYMAPS.find((k) => k.value === stored.keymap)?.value ?? d.keymap,
        tabSize: stored.tabSize === 2 || stored.tabSize === 4 ? stored.tabSize : d.tabSize,
        autocomplete: typeof stored.autocomplete === "boolean" ? stored.autocomplete : d.autocomplete,
    };
}

export function saveStoredEditorSettings(settings: EditorSettings): void {
    localStorage.setItem(EDITOR_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

/**
 * The combined turn a coding answer becomes — the same fold POST /api/answer does server-side (the
 * spoken/typed text, then the code as a ```lang fence), so the live transcript shows exactly what gets
 * stored. Code alone is a valid turn; with no code this is just the text.
 */
export function withCodeFence(text: string, code: string | undefined, language: string): string {
    if (!code?.trim()) return text;
    const fence = "```" + language + "\n" + code.trimEnd() + "\n```";
    return text.trim() ? `${text.trimEnd()}\n\n${fence}` : fence;
}

/** One run of a message: plain prose, or a fenced code block (its info string + body). */
export type MessagePart = { kind: "text"; text: string } | { kind: "code"; language: string; code: string };

// A ``` fence: an optional info string on the opening line, then the body up to the closing ```.
const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)\n?```/g;

/**
 * Split a message into prose and fenced code, in order, so a transcript can render the code as a <pre>
 * that keeps its indentation. Blank prose between parts is dropped; a message without a fence is one
 * text part.
 */
export function splitFencedCode(text: string): MessagePart[] {
    const parts: MessagePart[] = [];
    let last = 0;
    for (const m of text.matchAll(FENCE_RE)) {
        const start = m.index ?? 0;
        const before = text.slice(last, start).trim();
        if (before) parts.push({ kind: "text", text: before });
        parts.push({ kind: "code", language: m[1].trim(), code: m[2] });
        last = start + m[0].length;
    }
    const rest = text.slice(last).trim();
    if (rest) parts.push({ kind: "text", text: rest });
    return parts;
}

/** The last fenced code block in a message, or null — seeds the editor on resume. */
export function lastFencedCode(text: string): string | null {
    const code = splitFencedCode(text).filter((p) => p.kind === "code").pop();
    return code?.kind === "code" ? code.code : null;
}

/**
 * An interviewer message with the coding problem's statement swapped for `cue` — what's spoken and shown
 * in the live session, since the statement itself sits in the coding panel. A message that doesn't
 * quote the statement (a reaction, a probe) comes back unchanged.
 */
export function cueProblem(message: string, problemText: string | undefined, cue: string): string {
    return problemText && message.includes(problemText) ? message.replace(problemText, cue) : message;
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

/**
 * A compact "09/10/2026" date for the interview tables, from an ISO timestamp
 * (InterviewSummary.created_at). en-US fixes the mm/dd/yyyy ordering regardless of the viewer's locale.
 */
export function formatShortDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

/**
 * A "6:30 PM" clock time for a single transcript turn, from an ISO timestamp (InterviewTurn.at).
 * Just hours:minutes — the header already carries the date, so each message row shows only its time.
 */
export function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * A scorecard's overall (already round(,2) server-side) as a table cell reads it: always at least one
 * decimal so a whole number shows as "4.0" not "4", but keeping the second decimal when there is one
 * ("4.25"). Matches how the mocks render scores.
 */
export function formatScore(overall: number): string {
    return Number.isInteger(overall) ? overall.toFixed(1) : String(overall);
}

/**
 * The FastAPI `detail` string off a rejected RTK Query call (`{ status, data: { detail } }`), or null
 * when there isn't one (network failure, a 422's list-shaped detail). Lets a form show the server's
 * own reason — "paste the full job description…" — instead of a generic line.
 */
export function errorDetail(e: unknown): string | null {
    const detail = (e as { data?: { detail?: unknown } })?.data?.detail;
    return typeof detail === "string" ? detail : null;
}

/**
 * The two-part name for an interview wherever one is labelled (tables, the resume banner, the detail
 * and session headers): company · round for a job simulation, role · level for a bank interview. The
 * simulation fields are null on a bank interview, which is what picks the fallback.
 */
export function interviewTitle(iv: {
    role: string;
    level: string;
    company?: string | null;
    round?: string | null;
}): [string, string] {
    return iv.company && iv.round ? [iv.company, iv.round] : [iv.role, iv.level];
}

/**
 * A react-select Option seeded from a filter slug in the URL (e.g. role). Its value is the slug; the
 * label STARTS as the slug (a placeholder) so a form's draft mirrors the applied filter even before the
 * real name is fetched, and the caller swaps in the fetched name once it resolves. Null when there's
 * no slug.
 */
export function optionFromSlug(slug: string | null): SelectOption | null {
    return slug ? { value: slug, label: slug } : null;
}

/**
 * A react-select Option from a {slug, name} lookup row (a role/level as the profile returns it) —
 * value = slug, label = the REAL display name. The label-carrying counterpart to optionFromSlug, for
 * seeding a picker when the name is already in hand. Null when the row is absent (no default set).
 */
export function optionFromItem(item: BasePageItem | null | undefined): SelectOption | null {
    return item ? { value: item.slug, label: item.name } : null;
}

/**
 * The 0–3 password strength score + its label for the 3-segment <StrengthMeter> — length, a digit, a
 * symbol/mixed-case bonus. Shared by every place a new password is chosen (signup, reset, the settings
 * password card) so the meter reads identically across them. Purely presentational (never gates submit).
 */
export function passwordStrength(pw: string): { score: number; label: string } {
    if (!pw) return { score: 0, label: "" };
    let score = 0;
    if (pw.length >= 10) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw) || (/[a-z]/.test(pw) && /[A-Z]/.test(pw))) score++;
    return { score, label: ["Too short", "Weak", "Fair", "Strong"][score] };
}

/**
 * First/last name out of a Supabase auth `user_metadata` blob, for pre-filling the settings name form.
 * Prefers the explicit `first_name`/`last_name` the settings page writes; falls back to SPLITTING the
 * single `display_name` that signup captured (first word -> first name, the rest -> last name) so a
 * user who only ever set a display name still opens the form pre-filled. Empty strings when unset.
 */
export function deriveName(
    meta?: { first_name?: string; last_name?: string; display_name?: string } | null,
): { firstName: string; lastName: string } {
    if (meta?.first_name || meta?.last_name) {
        return { firstName: meta.first_name ?? "", lastName: meta.last_name ?? "" };
    }
    const display = (meta?.display_name ?? "").trim();
    if (!display) return { firstName: "", lastName: "" };
    const parts = display.split(/\s+/);
    return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

/**
 * The combined "First Last" display name we keep in sync alongside first_name/last_name (option A):
 * the Supabase dashboard's Display Name column reads user_metadata.display_name, and the app's initials
 * (initialsFrom) + dashboard greeting still read it too. Collapses to just whichever half is present.
 */
export function displayNameFrom(firstName: string, lastName: string): string {
    return `${firstName.trim()} ${lastName.trim()}`.trim();
}
