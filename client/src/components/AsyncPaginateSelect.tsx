/**
 * AsyncPaginateSelect — a reusable async, searchable, infinitely-paginating select. It owns the
 * WHOLE pagination dance (cursor threading, row→Option mapping, hasMore) internally; a caller
 * differentiates one instance from another by injecting the ENDPOINT to pull from (`fetchPage`, a
 * lazy RTK Query trigger) — nothing else. So a roles picker and a levels picker are the same
 * component with a different trigger passed in.
 *
 * It still knows NOTHING about react-hook-form — that glue lives in ControlledAsyncPaginateSelect.
 * The one domain assumption it does make: every paginated row exposes a `slug` (the value we send
 * back) and a `name` (the label we show), which is the shape both option endpoints already return.
 */
import type { ReactNode } from "react";
import { AsyncPaginate } from "react-select-async-paginate";
import type { GroupBase } from "react-select";
import type { OptionPageQuery, Page } from "../api";
import { pagedLoadOptions } from "../helpers";
import { nocturneSelectStyles } from "../selectStyles";

// The Option shape react-select speaks natively: the value we send back (a slug) plus the label
// we show. WHY Option and not a bare slug string: with async loading, the chosen option may not
// be in the currently-loaded page, so there's no list to look its label up in. Carrying the label
// ON the selected value sidesteps that — the option is self-describing.
export interface SelectOption {
    value: string;
    label: string;
    // a short secondary label (e.g. a question's type) a custom `formatOptionLabel` can show beside it
    badge?: string;
}

// The pagination cursor threaded through AsyncPaginate's `additional`. We page by number; each
// internal loadOptions call receives the current `page` and returns the next one.
export interface PageAdditional {
    page: number;
}

// The minimum a paginated row must expose for this component to render it: a slug + a name. Both
// RolePageItem and LevelPageItem satisfy this (levels also carry `rank`, which we ignore here).
interface SelectRow {
    slug: string;
    name: string;
    badge?: string; // carried onto the Option as-is (see SelectOption.badge)
}

// THE ONE INJECTION POINT: the endpoint that pulls a page of rows. This is a lazy RTK Query trigger
// (e.g. from useLazyGetRolesQuery) — call it with { q, page }, then `.unwrap()` for the Page envelope.
// Passing the trigger (not a hand-written loadOptions) is what keeps the fetch/paginate logic in ONE
// place (pagedLoadOptions), while still letting each instance hit its own route. Shared with the multi
// variant (AsyncPaginateMultiSelect).
export type FetchPage = (arg: OptionPageQuery) => { unwrap: () => Promise<Page<SelectRow>> };

export interface AsyncPaginateSelectProps {
    fetchPage: FetchPage;
    // Controlled value/onChange in Option shape. The RHF glue in ControlledAsyncPaginateSelect
    // feeds these from a form field; a non-form caller can drive them from plain useState.
    value: SelectOption | null;
    onChange: (option: SelectOption | null) => void;
    onBlur?: () => void;
    placeholder?: string;
    isDisabled?: boolean;
    // Show the clear (x) control — for an OPTIONAL filter where null is a real choice (e.g. "All jobs").
    isClearable?: boolean;
    // Force the loading spinner in the control — for when the SELECTED value is still being fetched by
    // a SEPARATE query (e.g. the profile default / dashboard role that seeds this picker), a gap during
    // which the control would otherwise just look empty and un-picked. This is independent of the option
    // list's own loading, which the component already indicates while a page is fetched. See the render:
    // a boolean here overrides that internal state, so we only force it (undefined = defer to internal).
    isLoading?: boolean;
    // Bust AsyncPaginate's per-search-term option cache when an external input changes (e.g. a
    // dependent filter). Rarely needed for the independent role/level lists, exposed for reuse.
    cacheUniqs?: ReadonlyArray<unknown>;
    // Render an option (in the menu and as the picked value) instead of the plain label text.
    formatOptionLabel?: (option: SelectOption) => ReactNode;
}

export function AsyncPaginateSelect({
    fetchPage,
    value,
    onChange,
    onBlur,
    placeholder,
    isDisabled,
    isClearable,
    isLoading,
    cacheUniqs,
    formatOptionLabel,
}: AsyncPaginateSelectProps) {
    // The pagination dance (cursor threading, row→Option mapping, hasMore), shared with the multi
    // variant; see pagedLoadOptions in helpers.ts.
    const loadOptions = pagedLoadOptions(fetchPage);

    return (
        <AsyncPaginate<SelectOption, GroupBase<SelectOption>, PageAdditional, false>
            value={value}
            loadOptions={loadOptions}
            // react-select hands back `SelectOption | null`; normalize undefined-ish to null so
            // the prop's contract (never undefined) holds for whatever consumes onChange.
            onChange={(option) => onChange(option ?? null)}
            onBlur={onBlur}
            // the STARTING cursor for the first loadOptions call; each call returns the next one.
            additional={{ page: 1 }}
            placeholder={placeholder}
            isDisabled={isDisabled}
            isClearable={isClearable}
            // `|| undefined` (not `?? false`): a boolean here OVERRIDES the library's own option-loading
            // spinner (it uses the prop when it's a boolean, else its internal state). We want to FORCE
            // the spinner only while an external seed query loads, and otherwise let the internal state
            // drive it, so we pass a boolean only when true and undefined the rest of the time.
            isLoading={isLoading || undefined}
            cacheUniqs={cacheUniqs}
            formatOptionLabel={formatOptionLabel}
            // Nocturne dark-theme styling (shared) — without it react-select's white menu + inherited
            // near-white option text render the dropdown unreadable. See selectStyles.ts.
            styles={nocturneSelectStyles}
        />
    );
}
