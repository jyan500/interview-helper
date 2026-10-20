/**
 * "Start from one of your questions" on the create form: search the candidate's own questions (every
 * role) and hand the picked one's full detail to `onPrefill`, which copies it into the form. The browse
 * row the picker lists has no roles or grading notes, so picking fetches the detail first.
 */
import { useState } from "react";
import {
    useLazyGetCustomQuestionQuery,
    useLazyGetOwnQuestionOptionsQuery,
    type CustomQuestionDetail,
} from "../../api";
import { useToast } from "../../toast/ToastProvider";
import { AsyncPaginateSelect, type SelectOption } from "../AsyncPaginateSelect";
import QuestionOptionLabel from "./QuestionOptionLabel";

export default function PrefillQuestionPicker({
    onPrefill,
    isDisabled,
}: {
    onPrefill: (question: CustomQuestionDetail) => void;
    isDisabled?: boolean;
}) {
    const { toast } = useToast();
    const [triggerOptions] = useLazyGetOwnQuestionOptionsQuery();
    const [triggerDetail, { isFetching }] = useLazyGetCustomQuestionQuery();
    const [picked, setPicked] = useState<SelectOption | null>(null);

    async function onPick(option: SelectOption | null) {
        setPicked(option);
        if (!option) return;
        // 1. load the full detail (roles + grading notes), 2. copy it into the form, 3. or say it failed
        try {
            onPrefill(await triggerDetail(option.value).unwrap());
        } catch {
            toast("Couldn't load that question.", { variant: "error" });
        }
    }

    return (
        <div className="field">
            <label>
                Start from one of your questions <span className="text-neutral-500">(optional)</span>
            </label>
            <AsyncPaginateSelect
                fetchPage={triggerOptions}
                value={picked}
                onChange={onPick}
                placeholder="Search your questions…"
                isClearable
                isLoading={isFetching}
                isDisabled={isDisabled || isFetching}
                formatOptionLabel={(option) => <QuestionOptionLabel option={option} />}
            />
            <span className="mt-1 text-[12.5px] text-neutral-500">Copies everything except the title.</span>
        </div>
    );
}
