/**
 * Shared react-select styling for the Nocturne dark theme, in ONE place so every <Select> /
 * <AsyncPaginate> in the app reads the same.
 *
 * WHY THIS EXISTS: react-select ships light-theme defaults — a WHITE menu (neutral0) and, for a
 * non-selected option, `color: inherit`. On our dark ground the options therefore inherited
 * `body { color: var(--color-ink) }` (near-white #e9e9ed) and rendered near-white-on-white —
 * invisible. Restyling the menu/control/options onto the Nocturne tokens fixes the contrast.
 *
 * The values are CSS `var(--color-*)` references (not JS constants) so this tracks the theme in
 * index.css automatically — react-select applies them as inline styles, which the browser resolves
 * against :root like any other var(). Typed permissively (`any` option) because the same config is
 * shared by selects with different Option shapes (SelectOption, the TTS EngineOption, …).
 */
import type { GroupBase, StylesConfig } from "react-select";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const nocturneSelectStyles: StylesConfig<any, boolean, GroupBase<any>> = {
    control: (base, state) => ({
        ...base,
        minHeight: 36,
        backgroundColor: "var(--color-surface)",
        borderColor: state.isFocused ? "var(--color-accent)" : "var(--color-divider)",
        boxShadow: "none",
        ":hover": { borderColor: "color-mix(in srgb, var(--color-ink) 45%, transparent)" },
    }),
    menu: (base) => ({
        ...base,
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-divider)",
        boxShadow: "var(--shadow-md)",
        overflow: "hidden",
    }),
    menuList: (base) => ({ ...base, paddingTop: 0, paddingBottom: 0 }),
    option: (base, state) => ({
        ...base,
        cursor: "pointer",
        // The whole point: readable ink for the option text, plus accent tints for focus/selection.
        color: state.isSelected ? "var(--color-accent-100)" : "var(--color-ink)",
        backgroundColor: state.isSelected
            ? "var(--color-accent-800)"
            : state.isFocused
              ? "var(--color-accent-900)"
              : "transparent",
        ":active": { backgroundColor: "var(--color-accent-800)" },
    }),
    singleValue: (base) => ({ ...base, color: "var(--color-ink)" }),
    input: (base) => ({ ...base, color: "var(--color-ink)" }),
    placeholder: (base) => ({
        ...base,
        color: "color-mix(in srgb, var(--color-ink) 40%, transparent)",
    }),
    noOptionsMessage: (base) => ({ ...base, color: "var(--color-neutral-400)" }),
    loadingMessage: (base) => ({ ...base, color: "var(--color-neutral-400)" }),
    indicatorSeparator: (base) => ({ ...base, backgroundColor: "var(--color-divider)" }),
    dropdownIndicator: (base, state) => ({
        ...base,
        color: state.isFocused ? "var(--color-accent)" : "var(--color-neutral-400)",
        ":hover": { color: "var(--color-accent)" },
    }),
    clearIndicator: (base) => ({
        ...base,
        color: "var(--color-neutral-400)",
        ":hover": { color: "var(--color-accent)" },
    }),
};
