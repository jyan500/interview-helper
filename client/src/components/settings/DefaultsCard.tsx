/**
 * Default role & level card — the same two searchable async pickers the dashboard kickoff uses, here
 * as a standalone "save my default" form. Persists to the profile via PATCH /api/profile
 * (useUpdateProfileMutation), so it becomes the dashboard kickoff's pre-fill and the signal panel's
 * default scope. This is the SAME default the dashboard's "Set as default" writes — two doors, one row.
 *
 * Applied on SUBMIT (a Save button), not on change, and both picks are required before it enables.
 */
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useToast } from "../../toast/ToastProvider";
import {
    useGetProfileQuery,
    useLazyGetLevelsQuery,
    useLazyGetRolesQuery,
    useUpdateProfileMutation,
} from "../../api";
import type { SelectOption } from "../AsyncPaginateSelect";
import { ControlledAsyncPaginateSelect } from "../ControlledAsyncPaginateSelect";
import Button from "../Button";
import SettingsCard from "./SettingsCard";

type DefaultsFields = {
    role: SelectOption | null;
    level: SelectOption | null;
};

export default function DefaultsCard() {
    const { toast } = useToast();
    const { control, handleSubmit, setValue, formState } = useForm<DefaultsFields>({
        defaultValues: { role: null, level: null },
        mode: "onChange",
    });

    // PRE-FILL from the saved default (GET /api/profile), once — guarded by a ref so it never clobbers
    // a pick the user has since made. A profile with no default leaves both pickers empty.
    const { data: profile } = useGetProfileQuery();
    const seeded = useRef(false);
    useEffect(() => {
        if (seeded.current || !profile) return;
        if (profile.role) setValue("role", { value: profile.role.slug, label: profile.role.name }, { shouldValidate: true });
        if (profile.level) setValue("level", { value: profile.level.slug, label: profile.level.name }, { shouldValidate: true });
        seeded.current = true;
    }, [profile, setValue]);

    // LAZY option triggers handed straight to the two async selects as their `fetchPage` — the select
    // owns paginate/map, we only inject WHICH endpoint (see ControlledAsyncPaginateSelect).
    const [triggerRoles] = useLazyGetRolesQuery();
    const [triggerLevels] = useLazyGetLevelsQuery();

    const [saveDefault, { isLoading: saving }] = useUpdateProfileMutation();
    async function onSubmit({ role, level }: DefaultsFields) {
        if (!role || !level) return; // narrows Option | null -> Option; `required` already guarantees it
        try {
            await saveDefault({ role: role.value, level: level.value }).unwrap();
            toast("Saved as your default role & level", { variant: "success" });
        } catch {
            toast("Couldn't save your default. Try again.", { variant: "error" });
        }
    }

    return (
        <SettingsCard
            title="Default role & level"
            description="Pre-fills the kickoff form and the dashboard's default scope."
        >
            <form onSubmit={handleSubmit(onSubmit)} className="mt-5 flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="field">
                        <label>Role</label>
                        <ControlledAsyncPaginateSelect
                            control={control}
                            name="role"
                            rules={{ required: true }}
                            fetchPage={triggerRoles}
                            placeholder="Search roles…"
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
                        />
                    </div>
                </div>

                <div className="flex justify-end">
                    <Button
                        type="submit"
                        variant="primary"
                        disabled={saving || !formState.isValid}
                        className="text-[15px] disabled:opacity-50"
                    >
                        {saving ? "Saving…" : "Save default"}
                    </Button>
                </div>
            </form>
        </SettingsCard>
    );
}
