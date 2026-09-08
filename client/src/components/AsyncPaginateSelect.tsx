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
import { AsyncPaginate } from "react-select-async-paginate";
import type { LoadOptions } from "react-select-async-paginate";
import type { GroupBase } from "react-select";
import type { OptionPageQuery, Page } from "../api";
import { nocturneSelectStyles } from "../selectStyles";

// The Option shape react-select speaks natively: the value we send back (a slug) plus the label
// we show. WHY Option and not a bare slug string: with async loading, the chosen option may not
// be in the currently-loaded page, so there's no list to look its label up in. Carrying the label
// ON the selected value sidesteps that — the option is self-describing.
export interface SelectOption {
    value: string;
    label: string;
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
}

export interface AsyncPaginateSelectProps {
    // THE ONE INJECTION POINT: the endpoint that pulls a page of rows. This is a lazy RTK Query
    // trigger (e.g. from useLazyGetRolesQuery) — call it with { q, page }, then `.unwrap()` for the
    // Page envelope. Passing the trigger (not a hand-written loadOptions) is what keeps the
    // fetch/paginate logic in ONE place, here, while still letting each instance hit its own route.
    fetchPage: (arg: OptionPageQuery) => { unwrap: () => Promise<Page<SelectRow>> };
    // Controlled value/onChange in Option shape. The RHF glue in ControlledAsyncPaginateSelect
    // feeds these from a form field; a non-form caller can drive them from plain useState.
    value: SelectOption | null;
    onChange: (option: SelectOption | null) => void;
    onBlur?: () => void;
    placeholder?: string;
    isDisabled?: boolean;
    // Bust AsyncPaginate's per-search-term option cache when an external input changes (e.g. a
    // dependent filter). Rarely needed for the independent role/level lists, exposed for reuse.
    cacheUniqs?: ReadonlyArray<unknown>;
}

export function AsyncPaginateSelect({
    fetchPage,
    value,
    onChange,
    onBlur,
    placeholder,
    isDisabled,
    cacheUniqs,
}: AsyncPaginateSelectProps) {
    // The pagination dance, owned here instead of at every call site. AsyncPaginate calls this with
    // the live search text + current cursor; we fetch that page, map rows→Options, and report both
    // the next cursor and whether more pages remain (page*size < total => there's another).
    const loadOptions: LoadOptions<SelectOption, GroupBase<SelectOption>, PageAdditional> = async (
        search,
        _loaded,
        additional,
    ) => {
        const page = additional?.page ?? 1;
        try {
            const res = await fetchPage({ q: search, page }).unwrap();
            return {
                options: res.items.map((row) => ({ value: row.slug, label: row.name })),
                hasMore: res.page * res.size < res.total,
                additional: { page: page + 1 },
            };
        } catch (e) {
            // loadOptions MUST NOT throw. react-select-async-paginate's error path (see its
            // requestOptions) only flips `isLoading` back to false on a rejected load — it leaves
            // `hasMore` at its previous value, which is `true` for a first load. That keeps the
            // library's "may I request?" gate open, so every subsequent re-render re-fires the fetch.
            // A token refresh makes this pathological: refreshSession() -> onAuthStateChange ->
            // AuthProvider re-renders the tree -> gate is open -> fetch -> 401 -> refresh -> ... a
            // tight retry loop against a failing endpoint (the bug seen intermittently on the pickers).
            //
            // Returning a TERMINAL page instead — no options, hasMore:false, cursor NOT advanced —
            // records a completed load with nothing more to fetch, which closes that gate. The user
            // can retry by changing the search text (a fresh cache key) or reopening the menu later.
            console.error("Failed to load options", e);
            return { options: [], hasMore: false, additional: { page } };
        }
    };

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
            cacheUniqs={cacheUniqs}
            // Nocturne dark-theme styling (shared) — without it react-select's white menu + inherited
            // near-white option text render the dropdown unreadable. See selectStyles.ts.
            styles={nocturneSelectStyles}
        />
    );
}
