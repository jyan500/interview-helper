/**
 * ControlledAsyncPaginateSelect — the React Hook Form integration for AsyncPaginateSelect, kept
 * DELIBERATELY SEPARATE from it. This is the whole "separation of concerns" the user asked for:
 * AsyncPaginateSelect is a plain controlled input (value/onChange), and THIS file is the only
 * place that knows about `control`, `Controller`, and form fields. Swap form libraries later and
 * only this wrapper changes; the select underneath is untouched.
 *
 * It's generic over the form (`TForm`) so `name` is type-checked against that form's fields, and
 * it forwards every non-form prop (loadOptions, placeholder, ...) straight through to the select.
 */
import { Controller } from "react-hook-form";
import type { Control, FieldValues, Path, RegisterOptions } from "react-hook-form";
import { AsyncPaginateSelect } from "./AsyncPaginateSelect";
import type { AsyncPaginateSelectProps, SelectOption } from "./AsyncPaginateSelect";

// Everything the plain select takes EXCEPT the three props Controller supplies itself
// (value/onChange/onBlur), plus the RHF wiring. `TForm extends FieldValues` ties `name` to a
// real field on the caller's form type.
interface ControlledAsyncPaginateSelectProps<TForm extends FieldValues>
    extends Omit<AsyncPaginateSelectProps, "value" | "onChange" | "onBlur"> {
    control: Control<TForm>;
    name: Path<TForm>;
    // validation rules for THIS field (e.g. { required: true }). The valueAs*/disabled keys don't
    // apply to a Controller-managed field, so they're omitted from the accepted shape.
    rules?: Omit<
        RegisterOptions<TForm, Path<TForm>>,
        "valueAsNumber" | "valueAsDate" | "setValueAs" | "disabled"
    >;
}

export function ControlledAsyncPaginateSelect<TForm extends FieldValues>({
    control,
    name,
    rules,
    ...selectProps
}: ControlledAsyncPaginateSelectProps<TForm>) {
    return (
        <Controller
            control={control}
            name={name}
            rules={rules}
            render={({ field }) => (
                <AsyncPaginateSelect
                    {...selectProps}
                    // field.value is typed as the field's value on TForm, which the generic can't
                    // prove is a SelectOption — the wrapper's contract is that callers point `name`
                    // at a `SelectOption | null` field, so we assert it at this one boundary.
                    value={(field.value ?? null) as SelectOption | null}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                />
            )}
        />
    );
}
