/**
 * In-session Settings — the panel behind the session header's gear icon, rendered inside the reusable
 * <Modal> shell (which owns the backdrop + close plumbing). The controls themselves (mode, mic + live
 * test meter, TTS engine) are <InterviewSettingsFields>, shared with the Interview settings page.
 *
 * Unlike the page there's no Save: mid-interview a change takes effect immediately. So the form here is
 * just the FormProvider the fields need — kept in sync with the session's current values (`values`, so a
 * "Switch to text" outside the modal shows here too) — and each field change is forwarded straight back
 * up. The test meter runs only while the modal is open.
 */
import { useEffect } from "react";
import { FormProvider, useForm } from "react-hook-form";
import Modal from "./Modal";
import InterviewSettingsFields, { type InterviewSettingsValues } from "./InterviewSettingsFields";
import type { AnswerMode, MicOption } from "../constants";
import type { TtsEngine } from "../voice/speech";

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
    mode: AnswerMode;
    onChangeMode: (m: AnswerMode) => void;
    ttsEngine: TtsEngine;
    onChangeTtsEngine: (e: TtsEngine) => void;
    micOptions: MicOption[];
    micDeviceId: string;
    onChangeMic: (id: string) => void;
    // Forwarded to <MicMeter>: called once the test meter's stream is live (real labels become readable).
    onMicReady: () => void;
}) {
    const form = useForm<InterviewSettingsValues>({ values: { mode, ttsEngine, micDeviceId } });

    // Apply each change live. `name` is set only for a field change (a sync from `values` has none), so
    // a value coming IN from the session is never echoed back out.
    useEffect(() => {
        const subscription = form.watch((values, { name }) => {
            if (name === "mode" && values.mode) onChangeMode(values.mode);
            if (name === "ttsEngine" && values.ttsEngine) onChangeTtsEngine(values.ttsEngine);
            if (name === "micDeviceId" && values.micDeviceId !== undefined) onChangeMic(values.micDeviceId);
        });
        return () => subscription.unsubscribe();
    }, [form, onChangeMode, onChangeTtsEngine, onChangeMic]);

    return (
        <Modal open={open} onClose={onClose} title="Settings">
            <FormProvider {...form}>
                <InterviewSettingsFields micOptions={micOptions} micTestActive={open} onMicReady={onMicReady} />
            </FormProvider>
        </Modal>
    );
}
