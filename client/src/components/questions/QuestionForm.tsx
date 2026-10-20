/**
 * The fields of the create / edit question form (QuestionModal mounts it once any edit detail has loaded,
 * so `question` seeds the defaults directly). With `question` it edits that question (a full-replace PUT);
 * without, it creates one (POST), pre-filling the role with `defaultRole`.
 *
 * Saving can take a few seconds: the server writes a grading guide for the question with an LLM, guided by
 * the optional "How should this be graded?" notes. On create it always does; on edit the SERVER decides,
 * by comparing the submitted text, type, level and notes against the stored question (a roles-only edit
 * is instant). The form only mirrors that comparison to choose whether to show the "writing the guide"
 * hint; it never tells the server what to do.
 */
import { useForm } from "react-hook-form";
import {
    useCreateCustomQuestionMutation,
    useLazyGetLevelsQuery,
    useLazyGetQuestionTypesQuery,
    useLazyGetRolesQuery,
    useUpdateCustomQuestionMutation,
    type CustomQuestionDetail,
    type CustomQuestionRequest,
} from "../../api";
import {
    CUSTOM_QUESTION_NOTES_MAX_CHARS,
    CUSTOM_QUESTION_TEXT_MAX_CHARS,
    CUSTOM_QUESTION_TITLE_MAX_CHARS,
} from "../../constants";
import { errorDetail } from "../../helpers";
import { useToast } from "../../toast/ToastProvider";
import type { SelectOption } from "../AsyncPaginateSelect";
import { ControlledAsyncPaginateSelect } from "../ControlledAsyncPaginateSelect";
import { ControlledAsyncPaginateMultiSelect } from "../ControlledAsyncPaginateMultiSelect";
import Button from "../Button";

type QuestionFields = {
    title: string;
    text: string;
    questionType: SelectOption | null;
    level: SelectOption | null;
    roles: SelectOption[];
    gradingNotes: string;
};

// The request body from the form values. The validation rules guarantee both pickers are set.
function toRequest(fields: QuestionFields): CustomQuestionRequest {
    return {
        title: fields.title.trim(),
        text: fields.text.trim(),
        type: fields.questionType!.value,
        level: fields.level!.value,
        roles: fields.roles.map((role) => role.value),
        grading_notes: fields.gradingNotes.trim(),
    };
}

// Whether saving `body` rewrites the grading guide: the same comparison the server's PUT makes (text,
// type, level and notes against the stored values; "" notes and no notes are the same). The title is only
// a display name, so it never rewrites the guide. Always on create.
function rewritesGuide(body: CustomQuestionRequest, question?: CustomQuestionDetail): boolean {
    if (!question) return true;
    return (
        body.text !== question.text ||
        body.type !== question.type_slug ||
        body.level !== question.level_slug ||
        body.grading_notes !== (question.grading_notes ?? "")
    );
}

export default function QuestionForm({
    question,
    defaultRole,
    onClose,
}: {
    question?: CustomQuestionDetail;
    defaultRole: SelectOption | null;
    onClose: () => void;
}) {
    const { toast } = useToast();
    const [createQuestion] = useCreateCustomQuestionMutation();
    const [updateQuestion] = useUpdateCustomQuestionMutation();
    const [triggerRoles] = useLazyGetRolesQuery();
    const [triggerLevels] = useLazyGetLevelsQuery();
    const [triggerTypes] = useLazyGetQuestionTypesQuery();

    const {
        control,
        register,
        handleSubmit,
        setError,
        watch,
        formState: { errors, isSubmitting },
    } = useForm<QuestionFields>({
        defaultValues: {
            title: question?.title ?? "",
            text: question?.text ?? "",
            questionType: question ? { value: question.type_slug, label: question.type_name } : null,
            level: question ? { value: question.level_slug, label: question.level_name } : null,
            roles: question
                ? question.roles.map((role) => ({ value: role.slug, label: role.name }))
                : defaultRole
                  ? [defaultRole]
                  : [],
            gradingNotes: question?.grading_notes ?? "",
        },
    });

    const values = watch();
    const titleLength = values.title.trim().length;
    const textLength = values.text.trim().length;
    const notesLength = values.gradingNotes.trim().length;
    // only meaningful once the pickers are set, which they are by the time a save is in flight
    const showGuideHint =
        isSubmitting && values.questionType !== null && values.level !== null &&
        rewritesGuide(toRequest(values), question);

    async function onSubmit(fields: QuestionFields) {
        const body = toRequest(fields);
        try {
            if (question) {
                await updateQuestion({ slug: question.slug, body }).unwrap();
            } else {
                await createQuestion(body).unwrap();
            }
            toast(question ? "Question updated" : "Question added to your saved questions", { variant: "success" });
            onClose();
        } catch (e) {
            setError("root", { message: errorDetail(e) ?? "Couldn't save this question. Try again." });
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="field">
                <label>Title</label>
                <input
                    className="input"
                    placeholder="Disagreeing with a technical decision"
                    {...register("title", {
                        validate: (value) => {
                            const length = value.trim().length;
                            if (length === 0) return "Title is required.";
                            if (length > CUSTOM_QUESTION_TITLE_MAX_CHARS)
                                return `Must be under ${CUSTOM_QUESTION_TITLE_MAX_CHARS} characters.`;
                            return true;
                        },
                    })}
                />
                <div className="mt-1 flex justify-between text-[12.5px]">
                    <span className="text-gap">{errors.title?.message}</span>
                    <span className={titleLength > CUSTOM_QUESTION_TITLE_MAX_CHARS ? "text-gap" : "text-neutral-500"}>
                        {titleLength} / {CUSTOM_QUESTION_TITLE_MAX_CHARS}
                    </span>
                </div>
            </div>

            <div className="field">
                <label>Question</label>
                <textarea
                    className="input min-h-[110px] leading-[1.5]"
                    placeholder="Tell me about a time you disagreed with a technical decision."
                    {...register("text", {
                        validate: (value) => {
                            const length = value.trim().length;
                            if (length === 0) return "Question is required.";
                            if (length > CUSTOM_QUESTION_TEXT_MAX_CHARS)
                                return `Must be under ${CUSTOM_QUESTION_TEXT_MAX_CHARS.toLocaleString()} characters.`;
                            return true;
                        },
                    })}
                />
                <div className="mt-1 flex justify-between text-[12.5px]">
                    <span className="text-gap">{errors.text?.message}</span>
                    <span className={textLength > CUSTOM_QUESTION_TEXT_MAX_CHARS ? "text-gap" : "text-neutral-500"}>
                        {textLength.toLocaleString()} / {CUSTOM_QUESTION_TEXT_MAX_CHARS.toLocaleString()}
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="field">
                    <label>Type</label>
                    <ControlledAsyncPaginateSelect
                        control={control}
                        name="questionType"
                        rules={{ required: "Type is required." }}
                        fetchPage={triggerTypes}
                        placeholder="Pick a type"
                    />
                    <span className="text-[12.5px] text-gap">{errors.questionType?.message}</span>
                </div>
                <div className="field">
                    <label>Level</label>
                    <ControlledAsyncPaginateSelect
                        control={control}
                        name="level"
                        rules={{ required: "Level is required." }}
                        fetchPage={triggerLevels}
                        placeholder="Pick a level"
                    />
                    <span className="text-[12.5px] text-gap">{errors.level?.message}</span>
                </div>
            </div>

            <div className="field">
                <label>Roles</label>
                <ControlledAsyncPaginateMultiSelect
                    control={control}
                    name="roles"
                    rules={{
                        // read from the form values: the generic wrapper types this field's value as a
                        // union of every path's type (see SkillsCard)
                        validate: (_value, { roles }) => roles.length > 0 || "Pick at least one role.",
                    }}
                    fetchPage={triggerRoles}
                    placeholder="Search roles…"
                />
                <span className="text-[12.5px] text-gap">{errors.roles?.message}</span>
            </div>

            <div className="field">
                <label>
                    How should this be graded? <span className="text-neutral-500">(optional)</span>
                </label>
                <textarea
                    className="input min-h-[110px] leading-[1.5]"
                    placeholder="What a strong answer covers, or what you want to be judged on. Leave it blank and we'll write a grading guide from the question."
                    {...register("gradingNotes", {
                        validate: (value) =>
                            value.trim().length <= CUSTOM_QUESTION_NOTES_MAX_CHARS ||
                            `Must be under ${CUSTOM_QUESTION_NOTES_MAX_CHARS.toLocaleString()} characters.`,
                    })}
                />
                <div className="mt-1 flex justify-between text-[12.5px]">
                    <span className="text-gap">{errors.gradingNotes?.message}</span>
                    <span className={notesLength > CUSTOM_QUESTION_NOTES_MAX_CHARS ? "text-gap" : "text-neutral-500"}>
                        {notesLength.toLocaleString()} / {CUSTOM_QUESTION_NOTES_MAX_CHARS.toLocaleString()}
                    </span>
                </div>
            </div>

            {errors.root && (
                <div className="rounded-md border border-gap-border bg-gap-bg px-3.5 py-[11px] text-[13.5px] leading-[1.45] text-gap">
                    {errors.root.message}
                </div>
            )}

            <div className="flex items-center justify-end gap-3">
                {showGuideHint && (
                    <span className="mr-auto text-[12.5px] text-neutral-400">
                        Writing the grading guide. This takes a few seconds.
                    </span>
                )}
                <Button variant="secondary" onClick={onClose} disabled={isSubmitting} className="text-[15px]">
                    Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isSubmitting} className="text-[15px]">
                    {isSubmitting ? "Saving…" : question ? "Save question" : "Create question"}
                </Button>
            </div>
        </form>
    );
}
