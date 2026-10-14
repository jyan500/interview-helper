/**
 * ControlledAsyncPaginateMultiSelect — the react-hook-form glue for AsyncPaginateMultiSelect, kept
 * separate from it for the same reason as ControlledAsyncPaginateSelect: this is the only place that
 * knows about `control`/`Controller`. Point `name` at a `SelectOption[]` field.
 */
import { Controller } from "react-hook-form";
import type { Control, FieldValues, Path, RegisterOptions } from "react-hook-form";
import { AsyncPaginateMultiSelect } from "./AsyncPaginateMultiSelect";
import type { AsyncPaginateMultiSelectProps } from "./AsyncPaginateMultiSelect";
import type { SelectOption } from "./AsyncPaginateSelect";

interface ControlledAsyncPaginateMultiSelectProps<TForm extends FieldValues>
    extends Omit<AsyncPaginateMultiSelectProps, "value" | "onChange" | "onBlur"> {
    control: Control<TForm>;
    name: Path<TForm>;
    rules?: Omit<
        RegisterOptions<TForm, Path<TForm>>,
        "valueAsNumber" | "valueAsDate" | "setValueAs" | "disabled"
    >;
}

export function ControlledAsyncPaginateMultiSelect<TForm extends FieldValues>({
    control,
    name,
    rules,
    ...selectProps
}: ControlledAsyncPaginateMultiSelectProps<TForm>) {
    return (
        <Controller
            control={control}
            name={name}
            rules={rules}
            render={({ field }) => (
                <AsyncPaginateMultiSelect
                    {...selectProps}
                    // the caller's contract: `name` is a SelectOption[] field (asserted at this one boundary)
                    value={(field.value ?? []) as SelectOption[]}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                />
            )}
        />
    );
}
