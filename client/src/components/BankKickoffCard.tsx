/**
 * BankKickoffCard — "Practice from the bank": start a bank interview in two decisions (role + level).
 * It lived on the dashboard until the dashboard went simulation-first; it now heads the Questions page,
 * next to the saved questions that interview asks. Self-contained: it owns its start sequence and
 * renders that sequence's overwrite confirm + blocking overlay itself.
 *
 * The searchable async role/level pickers are wrapped in RHF so both are required before Start
 * enables (mode "onChange" keeps formState.isValid live). They PRE-FILL from the profile default, keyed
 * on the default's slugs so they re-seed when it changes (e.g. on the Settings page) but never clobber
 * a manual pick — see useSeededSelectFields. "Set as default" saves the current picks as that default.
 */
import { useForm } from "react-hook-form";
import {
    useGetProfileQuery,
    useLazyGetLevelsQuery,
    useLazyGetRolesQuery,
    useUpdateProfileMutation,
} from "../api";
import { useSeededSelectFields, useStartSequence } from "../hooks";
import { optionFromItem } from "../helpers";
import { useToast } from "../toast/ToastProvider";
import type { SelectOption } from "./AsyncPaginateSelect";
import { ControlledAsyncPaginateSelect } from "./ControlledAsyncPaginateSelect";
import Button from "./Button";
import OverwriteInterviewModal from "./OverwriteInterviewModal";
import StartingOverlay from "./StartingOverlay";

// Each field holds react-select's Option ({ value: slug, label: name }) or null until picked; onStart
// unwraps `.value` to the slug the backend wants and `.label` for the session header.
type StartFormValues = {
    role: SelectOption | null;
    level: SelectOption | null;
};

export default function BankKickoffCard() {
    const { control, handleSubmit, formState, setValue, watch } = useForm<StartFormValues>({
        defaultValues: { role: null, level: null },
        mode: "onChange",
    });

    const { data: profile, isLoading: profileLoading } = useGetProfileQuery();
    useSeededSelectFields(
        setValue,
        profile ? `${profile.role?.slug ?? ""}|${profile.level?.slug ?? ""}` : null,
        [
            { name: "role", option: optionFromItem(profile?.role) },
            { name: "level", option: optionFromItem(profile?.level) },
        ],
        { shouldValidate: true },
    );

    // "Set as default" — persist the picked role + level (PATCH /api/profile) as next visit's pre-fill.
    const { toast } = useToast();
    const [saveDefault, { isLoading: savingDefault }] = useUpdateProfileMutation();
    const roleValue = watch("role");
    const levelValue = watch("level");
    async function onSetDefault() {
        if (!roleValue || !levelValue) return;
        try {
            await saveDefault({ role: roleValue.value, level: levelValue.value }).unwrap();
            toast("Saved as your default role & level", { variant: "success" });
        } catch {
            toast("Couldn't save your default. Try again.", { variant: "error" });
        }
    }

    // LAZY option triggers handed straight to the async selects as their `fetchPage`.
    const [triggerRoles] = useLazyGetRolesQuery();
    const [triggerLevels] = useLazyGetLevelsQuery();

    // handleSubmit only calls onStart once both required picks are valid, so the narrowing never bails.
    const startSequence = useStartSequence();
    function onStart({ role, level }: StartFormValues) {
        if (!role || !level) return;
        startSequence.start(
            { role: role.value, seniority: level.value },
            { role: role.label, level: level.label }, // human-readable labels for the session header
        );
    }

    return (
        <>
            {/* Outside the <form>: the modal isn't portaled, and its buttons shouldn't sit in this form. */}
            <OverwriteInterviewModal
                open={startSequence.confirmOpen}
                onClose={startSequence.cancel}
                onConfirm={startSequence.confirm}
            />
            {startSequence.starting && <StartingOverlay />}
            <form
                onSubmit={handleSubmit(onStart)}
                className="rounded-md border border-divider px-[22px] pb-[22px] pt-5"
            >
                <h2 className="font-heading text-[23px] font-medium">Practice from the bank</h2>
                <p className="mt-1 text-[13px] text-neutral-400">
                    A general interview for a role and level, asking your saved questions below.
                </p>

                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="field">
                        <label>Role</label>
                        <ControlledAsyncPaginateSelect
                            control={control}
                            name="role"
                            rules={{ required: true }}
                            fetchPage={triggerRoles}
                            placeholder="Search roles…"
                            isLoading={profileLoading}
                        />
                    </div>
                    <div className="field">
                        <label>Level</label>
                        <ControlledAsyncPaginateSelect
                            control={control}
                            name="level"
                            rules={{ required: true }}
                            fetchPage={triggerLevels}
                            placeholder="Search levels…"
                            isLoading={profileLoading}
                        />
                    </div>
                </div>

                <div className="mt-[18px] flex items-center justify-end gap-3">
                    {/* type="button" (Button's default) so it never submits the form / starts an interview. */}
                    <Button
                        variant="secondary"
                        onClick={onSetDefault}
                        disabled={savingDefault || !roleValue || !levelValue}
                        className="text-[15px] disabled:opacity-50"
                        style={{ padding: "11px 20px" }}
                    >
                        {savingDefault ? "Saving…" : "Set as default"}
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        // disabled until BOTH required selects are valid, while the POST is in flight, and
                        // until the resumable check settles (so we know whether to warn about overwriting)
                        disabled={startSequence.starting || !formState.isValid || startSequence.resumableLoading}
                        className="text-[15px] disabled:opacity-50"
                        style={{ padding: "11px 26px" }}
                    >
                        {startSequence.starting ? "Starting…" : "Start interview"}
                    </Button>
                </div>
            </form>
        </>
    );
}
