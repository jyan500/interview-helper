/**
 * In-session Settings — the panel behind the session header's gear icon, rendered inside the reusable
 * <Modal> shell (which owns the backdrop + close plumbing). It's the ONE home for the knobs that used to
 * be scattered (the mic + TTS pickers lived in the right rail; voice/text was only the in-column
 * "Switch to…" buttons):
 *
 *   - Mode         — voice ⇆ text.
 *   - Microphone   — which input the recorder + VAD capture from, PLUS a live "test your mic" meter
 *                    (<MicMeter>) so you can confirm the right device is picked BEFORE it's your turn to
 *                    answer. The choice is persisted by SessionPage (localStorage), so it's the default
 *                    next time — the fix for "the mic doesn't take effect until a turn passes".
 *   - Voice        — the TTS engine (neural OpenAI vs. free browser).
 *
 * Presentational: it owns no interview state, just renders the current values and calls back up.
 */
import Select from "react-select";
import Modal from "./Modal";
import MicMeter from "./MicMeter";
import { nocturneSelectStyles } from "../selectStyles";
import type { TtsEngine } from "../voice/speech";

type Mode = "voice" | "text";
type EngineOption = { value: TtsEngine; label: string };
type MicOption = { value: string; label: string };

// The TTS engine picker options (react-select shape). Static, so module scope.
const TTS_ENGINE_OPTIONS: EngineOption[] = [
    { value: "openai", label: "OpenAI — neural (uses tokens)" },
    { value: "browser", label: "Browser — free (robotic)" },
];

export default function SettingsModal({
    open,
    onClose,
    mode,
    onChangeMode,
    ttsEngine,
    onChangeTtsEngine,
    micOptions,
    micDeviceId,
    onChangeMic,
    onMicReady,
}: {
    open: boolean;
    onClose: () => void;
    mode: Mode;
    onChangeMode: (m: Mode) => void;
    ttsEngine: TtsEngine;
    onChangeTtsEngine: (e: TtsEngine) => void;
    micOptions: MicOption[];
    micDeviceId: string;
    onChangeMic: (id: string) => void;
    // Forwarded to <MicMeter>: called once the test meter's stream is live (real labels become readable).
    onMicReady: () => void;
}) {
    return (
        <Modal open={open} onClose={onClose} title="Settings">
            <div className="flex flex-col gap-5">
                {/* ── Mode ─────────────────────────────────────────────────── */}
                <div>
                    <div className="kicker">Mode</div>
                    <div className="mt-2 flex overflow-hidden rounded-md border border-divider">
                        {(["voice", "text"] as Mode[]).map((m) => (
                            <button
                                key={m}
                                onClick={() => onChangeMode(m)}
                                className={
                                    "flex-1 px-4 py-2 text-[14px] capitalize transition " +
                                    (mode === m ? "bg-accent text-white" : "text-neutral-300 hover:text-ink")
                                }
                            >
                                {m}
                            </button>
                        ))}
                    </div>
                </div>

                {/* ── Microphone + live test meter ─────────────────────────── */}
                <div>
                    <div className="kicker">Microphone</div>
                    <div className="mt-2">
                        <Select<MicOption>
                            options={micOptions}
                            value={micOptions.find((o) => o.value === micDeviceId) ?? micOptions[0]}
                            onChange={(opt) => opt && onChangeMic(opt.value)}
                            isSearchable={false}
                            styles={nocturneSelectStyles}
                        />
                    </div>
                    <MicMeter deviceId={micDeviceId} active={open} onReady={onMicReady} />
                </div>

                {/* ── Voice (TTS engine) ───────────────────────────────────── */}
                <div>
                    <div className="kicker">Voice</div>
                    <div className="mt-2">
                        <Select<EngineOption>
                            options={TTS_ENGINE_OPTIONS}
                            value={TTS_ENGINE_OPTIONS.find((o) => o.value === ttsEngine)}
                            onChange={(opt) => opt && onChangeTtsEngine(opt.value)}
                            isSearchable={false}
                            styles={nocturneSelectStyles}
                        />
                    </div>
                </div>
            </div>
        </Modal>
    );
}
