/**
 * A clickable column header for a sortable table. Renders the label plus a direction caret:
 * CaretUp/CaretDown (in ink) when this is the active sort column, a faint CaretUpDown otherwise
 * to advertise that the column can be sorted. Clicking calls `onSort(field)` — the caller owns the
 * toggle rule (same column flips asc/desc; a new column starts at its default direction) and the
 * URL write.
 *
 * Generic over the field type so it isn't tied to the interviews table's "date" | "score";
 * `[font:inherit] text-inherit` lets the button borrow the .table th typography (a <button>
 * otherwise resets font/color to UA defaults) so a sortable header matches a plain one.
 */
import { CaretUp, CaretDown, CaretUpDown } from "@phosphor-icons/react";

type SortOrder = "asc" | "desc";

export default function SortableHeader<T extends string>({
    label,
    field,
    activeField,
    order,
    onSort,
}: {
    label: string;
    field: T;
    activeField: T | null;
    order: SortOrder;
    onSort: (field: T) => void;
}) {
    const active = activeField === field;
    const Caret = active ? (order === "asc" ? CaretUp : CaretDown) : CaretUpDown;
    return (
        <th>
            <button
                type="button"
                onClick={() => onSort(field)}
                className="inline-flex items-center gap-1 [font:inherit] text-inherit uppercase tracking-[0.08em] cursor-pointer hover:text-ink transition-colors"
            >
                {label}
                <Caret
                    size={13}
                    weight="bold"
                    aria-hidden="true"
                    className={active ? "text-ink" : "text-neutral-500"}
                />
            </button>
        </th>
    );
}
