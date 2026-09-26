/**
 * A row of mutually exclusive options as joined buttons — the selected one filled with the accent. For
 * a handful of short, always-visible choices (voice/text, S/M/L, on/off) where a dropdown would hide
 * them behind a click. Used by both settings modals.
 */
export default function SegmentedControl<T extends string | number | boolean>({
    options,
    value,
    onChange,
    label,
}: {
    options: readonly { value: T; label: string }[];
    value: T;
    onChange: (value: T) => void;
    label: string; // for screen readers — the visible label is the caller's kicker
}) {
    return (
        <div role="radiogroup" aria-label={label} className="flex overflow-hidden rounded-md border border-divider">
            {options.map((o) => (
                <button
                    key={String(o.value)}
                    type="button"
                    role="radio"
                    aria-checked={value === o.value}
                    onClick={() => onChange(o.value)}
                    className={
                        "flex-1 px-4 py-2 text-[14px] transition " +
                        (value === o.value ? "bg-accent text-white" : "text-neutral-300 hover:text-ink")
                    }
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}
