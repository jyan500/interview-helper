/**
 * One row of a Dropdown: a route link with a leading phosphor icon. It doesn't close the menu itself;
 * the Dropdown panel closes on any click inside it.
 */
import { Link } from "react-router";
import type { Icon } from "@phosphor-icons/react";

export default function DropdownItem({ to, label, icon: ItemIcon }: { to: string; label: string; icon: Icon }) {
    return (
        <Link
            to={to}
            role="menuitem"
            className="flex items-center gap-2.5 px-3.5 py-2 text-[13.5px] text-ink hover:bg-accent-900"
        >
            <ItemIcon size={16} weight="regular" className="text-neutral-400" />
            {label}
        </Link>
    );
}
