/**
 * Small, reusable React hooks shared across pages. (Distinct from helpers.ts, which is pure,
 * React-free functions — anything that calls useState/useEffect/etc. lives here.)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { FieldValues, Path, PathValue, UseFormSetValue } from "react-hook-form";
import hark from "hark";
import { audioConstraints } from "./voice/helpers";
import {
    useGetMyInterviewsQuery,
    useSaveQuestionsMutation,
    useStartInterviewMutation,
    type StartInterviewRequest,
} from "./api";
import type { SelectOption } from "./components/AsyncPaginateSelect";
import type { SessionNavState } from "./pages/SessionLayout";
import { useToast } from "./toast/ToastProvider";
import {
    HARK_POLL_INTERVAL_MS,
    HARK_SPEAKING_THRESHOLD_DB,
    MIC_LEVEL_FLOOR_DB,
    MIC_LEVEL_CEIL_DB,
    MIC_SILENCE_LEVEL,
    MIC_SILENCE_MS,
    NO_INPUT_TIMEOUT_MS,
} from "./constants";

/**
 * One field to pre-fill in useSeededSelectFields: the form field `name` and the Option to seed it with
 * (null = leave this field alone, e.g. the source has no value for it).
 */
export interface SeededSelectField<TForm extends FieldValues> {
    name: Path<TForm>;
    option: SelectOption | null;
}

/**
 * Pre-fill one or more react-select form fields from async source data (a profile default, the
 * dashboard's resolved role, …), re-seeding whenever `key` changes and NEVER on a same-key refetch.
 * Pass `key = null` while there's nothing to seed from yet (data not loaded, no default set).
 *
 * WHY A KEY, NOT A FIRE-ONCE BOOLEAN — the bug this replaces: a boolean latches on whatever data is
 * cached at mount, so if that first read is STALE (the value from before the user changed it on another
 * page, not yet refetched) the fresh value that arrives moments later is ignored. Keying on the VALUE
 * re-seeds only when it genuinely changes — which also can't clobber a manual pick, since a manual pick
 * doesn't change the source data, so `key` is unchanged and this no-ops.
 *
 * The `fields`/`setValue` are read through a ref so the effect depends ONLY on `key`: callers rebuild
 * the array every render, and re-seeding must track the key changing, not that identity churn.
 */
export function useSeededSelectFields<TForm extends FieldValues>(
    setValue: UseFormSetValue<TForm>,
    key: string | null,
    fields: SeededSelectField<TForm>[],
    options?: { shouldValidate?: boolean },
): void {
    const seededKey = useRef<string | null>(null);
    const latest = useRef({ setValue, fields, shouldValidate: options?.shouldValidate });
    latest.current = { setValue, fields, shouldValidate: options?.shouldValidate };

    useEffect(() => {
        if (key === null || seededKey.current === key) return;
        const { setValue, fields, shouldValidate } = latest.current;
        for (const { name, option } of fields) {
            // SelectOption is what every caller's targeted field holds, but the generic can't prove it —
            // assert at this one boundary, the same contract ControlledAsyncPaginateSelect relies on.
            if (option) setValue(name, option as PathValue<TForm, Path<TForm>>, { shouldValidate });
        }
        seededKey.current = key;
    }, [key]);
}

/**
 * What a producer knows about the start that /session needs: the header labels, plus whether the round
 * opens the coding panel (everything in SessionNavState the POST response doesn't supply).
 */
export type StartLabels = Pick<SessionNavState, "role" | "level" | "company" | "round" | "hasCodeEditor">;

/**
 * The interview KICKOFF sequence, shared by every producer (the Dashboard's bank start and a Job page's
 * round cards): confirm before overwriting an unfinished interview, POST /api/interview, then hand the
 * fresh interview to /session via route state. We never navigate to /session without a real interview.
 *
 * The caller renders the two pieces of UI this drives: <OverwriteInterviewModal> (open = `confirmOpen`,
 * onConfirm = `confirm`, onClose = `cancel`) and <StartingOverlay> while `starting`. `resumableLoading`
 * gates the caller's Start button — until it settles we can't know whether to warn. A FAILED check
 * flips it false with no resumable id, so a broken query degrades to a direct start, not a dead button.
 */
export function useStartSequence() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const { data: resumableData, isLoading: resumableLoading } = useGetMyInterviewsQuery({ resumable: true });
    const resumableId = resumableData?.items[0]?.interview_id ?? null;
    const [startInterview, { isLoading: starting }] = useStartInterviewMutation();

    // The start held behind the overwrite confirmation (null = no confirm open).
    const [pending, setPending] = useState<{ request: StartInterviewRequest; labels: StartLabels } | null>(null);

    const run = useCallback(
        async (request: StartInterviewRequest, labels: StartLabels) => {
            try {
                const res = await startInterview(request).unwrap();
                const state: SessionNavState = {
                    interviewId: res.interview_id,
                    firstMessage: res.message,
                    question: res.question ?? null,
                    ...labels,
                };
                navigate("/session", { state });
            } catch {
                toast("Couldn't start your interview. Try again.", { variant: "error" });
            }
        },
        [startInterview, navigate, toast],
    );

    const start = useCallback(
        (request: StartInterviewRequest, labels: StartLabels) => {
            if (resumableId) setPending({ request, labels });
            else run(request, labels);
        },
        [resumableId, run],
    );

    // Confirmed: close the modal and hand off to the blocking overlay while the POST runs.
    const confirm = useCallback(() => {
        if (!pending) return;
        setPending(null);
        run(pending.request, pending.labels);
    }, [pending, run]);

    const cancel = useCallback(() => setPending(null), []);

    return { start, starting, resumableLoading, confirmOpen: pending !== null, confirm, cancel };
}

/**
 * The staged "My questions" selection behind the QuestionsTable + SelectionBar (the dashboard section,
 * the Add-question modal, and the Questions page all use it). Checkbox toggles are LOCAL until Save —
 * the user reviews a running count first, then commits the whole edit in one batch.
 *
 * WHY TWO DELTA SETS (add / remove) instead of one "checked" set: the table is paginated, so at any
 * moment we've only SEEN some rows — we can't hold "the full set of checked slugs". What we CAN track
 * is what the user CHANGED relative to the server's saved truth: `add` = unsaved questions they ticked,
 * `remove` = saved questions they unticked. By construction `add` only ever holds server-unsaved slugs
 * and `remove` only server-saved ones (see toggle), which is what makes `selectedCount` exact:
 *   selectedCount = savedTotal + add - remove
 * where `savedTotal` is the count of already-saved matching questions (a mine=true query's `total`).
 *
 * `save()` sends the two deltas as one PUT batch, toasts, and clears them; the "Questions" tag
 * invalidation then refetches every mounted list so the checkboxes reflect the new server truth.
 */
export function useQuestionSelection(savedTotal: number) {
    const [add, setAdd] = useState<Set<string>>(new Set());
    const [remove, setRemove] = useState<Set<string>>(new Set());
    const [saveQuestions, { isLoading: saving }] = useSaveQuestionsMutation();
    const { toast } = useToast();

    // A row is checked if it's server-saved and NOT staged for removal, or unsaved and staged to add.
    const isChecked = useCallback(
        (slug: string, serverSelected: boolean) =>
            serverSelected ? !remove.has(slug) : add.has(slug),
        [add, remove],
    );

    // Flip a row. Toggling a server-saved row lives in `remove`; an unsaved row in `add` — so each set
    // only ever holds slugs of its own kind, keeping selectedCount's arithmetic correct.
    const toggle = useCallback((slug: string, serverSelected: boolean) => {
        const setter = serverSelected ? setRemove : setAdd;
        setter((prev) => {
            const next = new Set(prev);
            if (next.has(slug)) next.delete(slug);
            else next.add(slug);
            return next;
        });
    }, []);

    const dirty = add.size > 0 || remove.size > 0;
    const selectedCount = savedTotal + add.size - remove.size;

    const reset = useCallback(() => {
        setAdd(new Set());
        setRemove(new Set());
    }, []);

    const save = useCallback(async () => {
        try {
            await saveQuestions({ add: [...add], remove: [...remove] }).unwrap();
            reset();
            toast("Saved your questions", { variant: "success" });
        } catch {
            toast("Couldn't save your questions. Try again.", { variant: "error" });
        }
    }, [add, remove, saveQuestions, reset, toast]);

    return useMemo(
        () => ({ isChecked, toggle, dirty, selectedCount, saving, reset, save }),
        [isChecked, toggle, dirty, selectedCount, saving, reset, save],
    );
}

/**
 * The applied slugs a caller hands `apply` — each nullable (null = no filter / "all"). `q` is the raw
 * search text; the three pickers carry the chosen slug or null.
 */
export interface AppliedSectionFilters {
    q: string;
    role: string | null;
    level: string | null;
    questionType: string | null;
    // Optional "saved only" toggle — only the Add-question modal uses it (its single table stands in for
    // the Questions page's Saved/Other split). useSectionFilters ignores it (it's not a URL param).
    savedOnly?: boolean;
}

/**
 * The URL-backed filter state for ONE section of the Questions page. The page shows TWO independent
 * filter sets — the "Saved" table and the "Other" table — so each gets its own `prefix` ("s_" / "o_")
 * and its own slice of the query string (`s_q`, `s_role`, `s_level`, `s_type`, `s_page`, and the "o_"
 * counterparts). THE URL IS THE SOURCE OF TRUTH (same rule as the Interviews page): the applied values
 * are read from the query string every render, so a deep link reproduces both tables' views and
 * Back/Forward just work; a section only WRITES the URL on Search/Clear/page-change.
 *
 * Every write PRESERVES the other section's params (it copies the live `URLSearchParams` and touches
 * only this prefix's keys), so filtering one table never disturbs the other. Applying a filter or
 * clearing resets THIS section to page 1; the other section stays put.
 */
export interface SectionFilters {
    // applied values (from the URL), undefined when the key is absent — role stays undefined here even
    // though the page falls back to a default role, so `hasFilters` reflects only user-set filters.
    q?: string;
    role?: string;
    level?: string;
    questionType?: string;
    page: number;
    hasFilters: boolean;
    apply: (values: AppliedSectionFilters) => void;
    clear: () => void;
    goToPage: (p: number) => void;
}

export function useSectionFilters(prefix: string): SectionFilters {
    const [searchParams, setSearchParams] = useSearchParams();
    const key = useCallback((k: string) => `${prefix}${k}`, [prefix]);

    const q = searchParams.get(key("q")) || undefined;
    const role = searchParams.get(key("role")) || undefined;
    const level = searchParams.get(key("level")) || undefined;
    const questionType = searchParams.get(key("type")) || undefined;
    const page = Number(searchParams.get(key("page"))) || 1;

    const apply = useCallback(
        (values: AppliedSectionFilters) => {
            // functional updater so a write always builds on the LIVE params, never a stale copy — the
            // two sections share one query string and could each be edited between renders.
            setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                const set = (k: string, v: string | null | undefined) =>
                    v && v.trim() ? next.set(key(k), v.trim()) : next.delete(key(k));
                set("q", values.q);
                set("role", values.role);
                set("level", values.level);
                set("type", values.questionType);
                next.delete(key("page")); // a changed filter resets THIS section to page 1
                return next;
            });
        },
        [key, setSearchParams],
    );

    const clear = useCallback(() => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            ["q", "role", "level", "type", "page"].forEach((k) => next.delete(key(k)));
            return next;
        });
    }, [key, setSearchParams]);

    const goToPage = useCallback(
        (p: number) => {
            setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set(key("page"), String(p));
                return next;
            });
        },
        [key, setSearchParams],
    );

    return {
        q,
        role,
        level,
        questionType,
        page,
        hasFilters: Boolean(q || role || level || questionType),
        apply,
        clear,
        goToPage,
    };
}

/**
 * A running "mm:ss" clock that starts when the hook mounts and ticks every second. Used by the
 * interview session header to show elapsed time. Returns the formatted string directly so callers
 * don't repeat the padding; the interval is cleaned up on unmount.
 */
export function useElapsedClock(): string {
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        const id = window.setInterval(() => setElapsed((s) => s + 1), 1000);
        return () => window.clearInterval(id);
    }, []);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    return `${mm}:${ss}`;
}

/**
 * Is the candidate speaking right now? A boolean driven by `hark` watching the live mic stream — the
 * analog of the AI's `speaking` (which tracks real TTS playback), so the candidate's mic icon can
 * pulse on actual speech instead of merely on "the mic is armed" (`listening`).
 *
 * hark is a pure OBSERVER: it attaches to the stream we already own (exposed by useSmartVoiceTurn) and
 * emits speaking / stopped_speaking with its own hysteresis, so no second getUserMedia, no conflict
 * with our recorder/VAD, and no on/off flicker to debounce ourselves. Deliberately NOT the Silero VAD
 * (useVoiceActivity), which does turn-taking and only runs in smart mode.
 *
 * Pass the stream from useSmartVoiceTurn; pass null while not recording and this resets to false. The
 * harker (and its AudioContext) is stopped when the stream changes or on unmount.
 */
export function useSpeaking(stream: MediaStream | null): boolean {
    const [speaking, setSpeaking] = useState(false);

    useEffect(() => {
        if (!stream) {
            setSpeaking(false);
            return;
        }
        const harker = hark(stream, {
            threshold: HARK_SPEAKING_THRESHOLD_DB,
            interval: HARK_POLL_INTERVAL_MS,
            play: false, // never route the mic back to the speakers
        });
        harker.on("speaking", () => setSpeaking(true));
        harker.on("stopped_speaking", () => setSpeaking(false));
        return () => {
            harker.stop(); // tears down hark's listeners + its AudioContext
            setSpeaking(false);
        };
    }, [stream]);

    return speaking;
}

/**
 * The "check your mic" watch. While the mic is armed (`listening`) but NO sound is heard through it
 * within NO_INPUT_TIMEOUT_MS, raise `noInput` — the candidate never started, or (the case this really
 * catches) the wrong/dead mic is selected and their voice isn't being picked up at all.
 *
 * `speaking` is hark's "is any sound coming through THIS mic right now" (useSpeaking) — deliberately
 * hark, NOT the Silero turn-taking VAD: "is the mic hearing anything" is exactly the wrong-mic
 * question, and we must never accuse a working-but-quiet mic. The moment sound is heard the watch is
 * DISARMED for the rest of the recording, so a later thinking-pause can't re-trigger it — smart mode's
 * post-speech silence is the countdown's job, and manual mode's is deliberately nothing. It re-arms
 * from scratch each time the mic re-opens (the next `listening` edge).
 *
 * `dismiss` hides the prompt without waiting for speech — wired to its "check mic settings" button, so
 * opening Settings clears it. It stays dismissed for this recording (the timer has already fired once).
 */
export function useNoInputPrompt(listening: boolean, speaking: boolean): { noInput: boolean; dismiss: () => void } {
    const [noInput, setNoInput] = useState(false);
    const spokeRef = useRef(false); // has any sound been heard since the mic last armed?

    // Sound heard -> disarm for this recording and clear a prompt already showing.
    useEffect(() => {
        if (speaking) {
            spokeRef.current = true;
            setNoInput(false);
        }
    }, [speaking]);

    // Arm on the listening edge: reset, then fire ONCE if still silent after the timeout. The cleanup
    // (mic stopped -> listening false) clears the pending timer AND the prompt so the next turn is clean.
    useEffect(() => {
        if (!listening) {
            setNoInput(false);
            spokeRef.current = false;
            return;
        }
        spokeRef.current = false;
        const timer = window.setTimeout(() => {
            if (!spokeRef.current) setNoInput(true);
        }, NO_INPUT_TIMEOUT_MS);
        return () => window.clearTimeout(timer);
    }, [listening]);

    const dismiss = useCallback(() => setNoInput(false), []);
    return { noInput, dismiss };
}

/**
 * The available audio-input devices (microphones), for a device picker. Returns the list plus a
 * `refresh` the caller invokes once mic permission is granted.
 *
 * THE PERMISSION CATCH: before the user grants mic access, enumerateDevices() still lists the devices
 * but every `label` is BLANK (a privacy measure) — so the picker can only show generic "Microphone N"
 * until then. After the first getUserMedia grant the labels populate, but no event necessarily fires,
 * so the consumer calls refresh() when its stream opens to re-read them. We also listen for
 * `devicechange` (mic plugged/unplugged) to keep the list live.
 */
export function useAudioInputDevices(): { devices: MediaDeviceInfo[]; refresh: () => void } {
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

    const refresh = useCallback(async () => {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        try {
            const all = await navigator.mediaDevices.enumerateDevices();
            setDevices(all.filter((d) => d.kind === "audioinput"));
        } catch (e) {
            console.error("Failed to enumerate audio input devices:", e);
        }
    }, []);

    useEffect(() => {
        refresh();
        const md = navigator.mediaDevices;
        md?.addEventListener?.("devicechange", refresh);
        return () => md?.removeEventListener?.("devicechange", refresh);
    }, [refresh]);

    return { devices, refresh };
}

/**
 * Turn a getUserMedia rejection into one line a candidate can act on. The DOMException `name` is the
 * stable signal (the human message is browser-specific); the two we actually hit are a denied permission
 * prompt and a chosen device that's since been unplugged (our `exact` deviceId constraint makes that
 * fail loudly by design — see audioConstraints).
 */
function micErrorMessage(e: unknown): string {
    const name = (e as { name?: string })?.name;
    if (name === "NotAllowedError" || name === "SecurityError")
        return "Microphone access is blocked. Allow it in your browser settings.";
    if (name === "NotFoundError" || name === "OverconstrainedError")
        return "That microphone isn't available. Pick another.";
    return "Couldn't open the microphone.";
}

/**
 * A live microphone INPUT-LEVEL meter for the Settings modal's "test your mic" bar. While `active`, it
 * opens its OWN getUserMedia stream on `deviceId` (independent of the recorder — a mic can back several
 * readers at once) and hands it to `hark`, the same loudness library useSpeaking uses. hark's
 * volume_change reports the input level in dBFS; we map it to a 0..1 bar and watch for sustained quiet:
 *
 *   level  — 0..1, hark's dB mapped onto [MIC_LEVEL_FLOOR_DB, MIC_LEVEL_CEIL_DB]. ~0 when quiet, climbs
 *            toward 1 as you talk: the bar that "shoots to the right" when speaking.
 *   silent — true once the level has stayed below MIC_SILENCE_LEVEL for MIC_SILENCE_MS: drives the
 *            "no audio detected" warning (wrong mic, muted hardware, a permission that opened a dead
 *            track). Starts false so a freshly-opened meter isn't accusatory before you've spoken.
 *   ready  — true once the stream is live. The consumer re-reads its device list on this edge, because
 *            enumerateDevices() only returns real mic LABELS after a getUserMedia grant.
 *   error  — a human-readable reason the meter couldn't open (denied permission, device gone), else null.
 *
 * Everything is torn down when `active` goes false, `deviceId` changes, or the component unmounts —
 * hark releases its AudioContext and we stop the stream's tracks, so the browser's "recording" dot
 * clears when the modal closes.
 */
export function useMicLevel(
    deviceId: string,
    active: boolean,
): { level: number; silent: boolean; ready: boolean; error: string | null } {
    const [level, setLevel] = useState(0);
    const [silent, setSilent] = useState(false);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!active) {
            setLevel(0);
            setSilent(false);
            setReady(false);
            setError(null);
            return;
        }

        let cancelled = false; // guards the async getUserMedia gap: the effect can tear down mid-open
        let stream: MediaStream | null = null;
        let harker: ReturnType<typeof hark> | null = null;
        let lastLoud = Date.now(); // last moment the input rose above the silence floor

        (async () => {
            try {
                // `exact` deviceId (falsy -> system default) matches the recorder/VAD, so the meter tests
                // the SAME mic the interview will capture from.
                stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(deviceId || null) });
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                setReady(true); // stream is live -> caller can now re-read real device labels

                harker = hark(stream, { interval: HARK_POLL_INTERVAL_MS, play: false });
                harker.on("volume_change", (dB: number) => {
                    // Map hark's dBFS onto the bar's 0..1 width; below the floor / above the ceiling clamp.
                    const mapped = (dB - MIC_LEVEL_FLOOR_DB) / (MIC_LEVEL_CEIL_DB - MIC_LEVEL_FLOOR_DB);
                    const clamped = Math.max(0, Math.min(1, mapped));
                    setLevel(clamped);

                    const now = Date.now();
                    if (clamped > MIC_SILENCE_LEVEL) lastLoud = now;
                    setSilent(now - lastLoud > MIC_SILENCE_MS);
                });
            } catch (e) {
                if (!cancelled) setError(micErrorMessage(e));
            }
        })();

        return () => {
            cancelled = true;
            harker?.stop(); // tears down hark's listeners + its AudioContext
            stream?.getTracks().forEach((t) => t.stop()); // release the mic (hark doesn't own the stream)
        };
    }, [deviceId, active]);

    return { level, silent, ready, error };
}
