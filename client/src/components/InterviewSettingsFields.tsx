/**
 * The interview settings controls, shared by the in-session Settings modal (behind the header gear) and
 * the Interview settings page (set them before an interview starts):
 *
 *   - Mode         — voice ⇆ text.
 *   - Microphone   — which input the recorder + VAD capture from, PLUS a live "test your mic" meter
 *                    (<MicMeter>) so you can confirm the right device is picked BEFORE it's your turn to
 *                    answer.
 *   - Voice        — the TTS engine (neural OpenAI vs. free browser).
 *
 * The values live in the caller's react-hook-form, read here through useFormContext (the caller wraps
 * this in a <FormProvider> of InterviewSettingsValues). Both controls are custom (a button row and a
 * react-select), so each is wired with a Controller rather than register. What happens on change is the
 * caller's call: the page saves on submit, the modal applies each change live.
 */
import Select from "react-select";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import MicMeter from "./MicMeter";
import SegmentedControl from "./SegmentedControl";
import { nocturneSelectStyles } from "../selectStyles";
import type { AnswerMode, MicOption } from "../constants";
import type { TtsEngine } from "../voice/speech";

// The form shape every caller's FormProvider must hold.
export type InterviewSettingsValues = {
    mode: AnswerMode;
    ttsEngine: TtsEngine;
    micDeviceId: string;
};

type EngineOption = { value: TtsEngine; label: string };

const MODE_OPTIONS: { value: AnswerMode; label: string }[] = [
    { value: "voice", label: "Voice" },
    { value: "text", label: "Text" },
];

// The TTS engine picker options (react-select shape). Static, so module scope.
const TTS_ENGINE_OPTIONS: EngineOption[] = [
    { value: "openai", label: "OpenAI (neural, uses tokens)" },
    { value: "browser", label: "Browser (free, robotic)" },
];

export default function InterviewSettingsFields({
    micOptions,
    micTestActive,
    onMicReady,
}: {
    micOptions: MicOption[];
    // Runs the live test meter (it opens its own mic stream while true).
    micTestActive: boolean;
    // Forwarded to <MicMeter>: called once the test meter's stream is live (real labels become readable).
    onMicReady: () => void;
}) {
    const { control } = useFormContext<InterviewSettingsValues>();
    // The meter tests the PICKED mic, saved or not.
    const micDeviceId = useWatch({ control, name: "micDeviceId" });

    return (
        <div className="flex flex-col gap-5">
            {/* ── Mode ─────────────────────────────────────────────────── */}
            <div>
                <div className="kicker">Mode</div>
                <div className="mt-2">
                    <Controller
                        control={control}
                        name="mode"
                        render={({ field }) => (
                            <SegmentedControl<AnswerMode>
                                label="Mode"
                                options={MODE_OPTIONS}
                                value={field.value}
                                onChange={field.onChange}
                            />
                        )}
                    />
                </div>
            </div>

            {/* ── Microphone + live test meter ─────────────────────────── */}
            <div>
                <div className="kicker">Microphone</div>
                <div className="mt-2">
                    <Controller
                        control={control}
                        name="micDeviceId"
                        render={({ field }) => (
                            <Select<MicOption>
                                options={micOptions}
                                value={micOptions.find((o) => o.value === field.value) ?? micOptions[0]}
                                onChange={(opt) => opt && field.onChange(opt.value)}
                                onBlur={field.onBlur}
                                isSearchable={false}
                                styles={nocturneSelectStyles}
                            />
                        )}
                    />
                </div>
                <MicMeter deviceId={micDeviceId} active={micTestActive} onReady={onMicReady} />
            </div>

            {/* ── Voice (TTS engine) ───────────────────────────────────── */}
            <div>
                <div className="kicker">Voice</div>
                <div className="mt-2">
                    <Controller
                        control={control}
                        name="ttsEngine"
                        render={({ field }) => (
                            <Select<EngineOption>
                                options={TTS_ENGINE_OPTIONS}
                                value={TTS_ENGINE_OPTIONS.find((o) => o.value === field.value)}
                                onChange={(opt) => opt && field.onChange(opt.value)}
                                onBlur={field.onBlur}
                                isSearchable={false}
                                styles={nocturneSelectStyles}
                            />
                        )}
                    />
                </div>
            </div>
        </div>
    );
}
