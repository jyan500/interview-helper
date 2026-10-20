/**
 * One option in PrefillQuestionPicker (menu row and picked value): the question's title on the left,
 * truncated with an ellipsis when long, and its type as a badge on the right.
 */
import type { SelectOption } from "../AsyncPaginateSelect";

export default function QuestionOptionLabel({ option }: { option: SelectOption }) {
    return (
        <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="min-w-0 truncate" title={option.label}>
                {option.label}
            </span>
            {option.badge && <span className="tag tag-neutral flex-none">{option.badge}</span>}
        </div>
    );
}
