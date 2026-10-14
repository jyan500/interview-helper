/**
 * Interview settings (/settings/interview) — the same knobs as the in-session Settings modal (mode, mic
 * + live test meter, TTS engine), set BEFORE an interview starts. Rendered inside SettingsLayout.
 *
 * Picking an option only edits the form; Save writes the values to localStorage (via
 * useInterviewSettings' setters), and the session seeds from there, so the next interview opens with
 * them. The mic meter tests the picked (even unsaved) mic while the page is open; its stream is also the
 * permission grant that makes real device names readable.
 */
import { FormProvider, useForm } from "react-hook-form";
import Button from "../components/Button";
import InterviewSettingsFields, { type InterviewSettingsValues } from "../components/InterviewSettingsFields";
import SettingsCard from "../components/settings/SettingsCard";
import { useInterviewSettings, useMicOptions } from "../hooks";
import { useToast } from "../toast/ToastProvider";

export default function InterviewSettingsPage() {
    const { toast } = useToast();
    const { mode, setMode, ttsEngine, setTtsEngine, micDeviceId, setMicDeviceId } = useInterviewSettings();
    const { micOptions, refresh: refreshMics } = useMicOptions();

    // The draft, seeded from the saved settings; the fields read and write it through the FormProvider.
    const form = useForm<InterviewSettingsValues>({
        defaultValues: { mode, ttsEngine, micDeviceId },
    });
    const { isDirty } = form.formState;

    function onSubmit(values: InterviewSettingsValues) {
        // 1. Persist each value (the setters write localStorage).
        setMode(values.mode);
        setTtsEngine(values.ttsEngine);
        setMicDeviceId(values.micDeviceId);
        // 2. The saved values are the new baseline, so Save disables until the next change.
        form.reset(values);
        toast("Interview settings saved", { variant: "success" });
    }

    return (
        <>
            <h1 className="mt-1.5 font-heading text-[34px] font-medium leading-[1.05]">Interview settings</h1>

            <div className="mt-6 flex flex-col gap-6">
                <SettingsCard
                    title="Audio and mode"
                    description="Your next interview starts with these. You can still change them from the gear during an interview."
                >
                    <FormProvider {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-5 flex flex-col gap-5">
                            <InterviewSettingsFields micOptions={micOptions} micTestActive onMicReady={refreshMics} />

                            <div className="flex justify-end">
                                <Button type="submit" variant="primary" disabled={!isDirty} className="text-[15px]">
                                    Save
                                </Button>
                            </div>
                        </form>
                    </FormProvider>
                </SettingsCard>
            </div>
        </>
    );
}
