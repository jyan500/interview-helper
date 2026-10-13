/**
 * AsyncPaginateMultiSelect — the MULTI-pick sibling of AsyncPaginateSelect: the same async, searchable,
 * infinitely-paginating picker over an injected endpoint (`fetchPage`), but its value is a LIST of
 * Options, shown as removable chips. First consumer: the Profile page's skills picker.
 *
 * A separate component rather than an `isMulti` flag on AsyncPaginateSelect because the value/onChange
 * types differ (Option[] vs Option | null) and every existing single-pick caller would otherwise have to
 * narrow a union. The pagination itself is shared (pagedLoadOptions), so there's still one copy of it.
 *
 * Like its sibling it knows nothing about react-hook-form; ControlledAsyncPaginateMultiSelect is the glue.
 */
import { AsyncPaginate } from "react-select-async-paginate";
import type { GroupBase } from "react-select";
import { pagedLoadOptions } from "../helpers";
import { nocturneSelectStyles } from "../selectStyles";
import type { FetchPage, PageAdditional, SelectOption } from "./AsyncPaginateSelect";

export interface AsyncPaginateMultiSelectProps {
    fetchPage: FetchPage;
    value: SelectOption[];
    onChange: (options: SelectOption[]) => void;
    onBlur?: () => void;
    placeholder?: string;
    isDisabled?: boolean;
    // Force the control's spinner while the SELECTED values are still being fetched by a separate query
    // (see AsyncPaginateSelect's isLoading for why it's `|| undefined`).
    isLoading?: boolean;
}

export function AsyncPaginateMultiSelect({
    fetchPage,
    value,
    onChange,
    onBlur,
    placeholder,
    isDisabled,
    isLoading,
}: AsyncPaginateMultiSelectProps) {
    return (
        <AsyncPaginate<SelectOption, GroupBase<SelectOption>, PageAdditional, true>
            isMulti
            value={value}
            loadOptions={pagedLoadOptions(fetchPage)}
            // react-select hands back a readonly array; copy it so the form holds a plain SelectOption[].
            onChange={(options) => onChange([...options])}
            onBlur={onBlur}
            additional={{ page: 1 }}
            placeholder={placeholder}
            isDisabled={isDisabled}
            isLoading={isLoading || undefined}
            // keep the menu open between picks, so adding several skills doesn't mean reopening it each time
            closeMenuOnSelect={false}
            styles={nocturneSelectStyles}
        />
    );
}
