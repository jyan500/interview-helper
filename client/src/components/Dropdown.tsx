/**
 * Reusable dropdown SHELL — a trigger button plus the panel it opens. It owns the open state and the
 * close plumbing; the menu's CONTENT is the caller's, passed as `children` (DropdownItem rows, usually).
 *
 * Closes on:
 *   - a press outside the trigger + panel, or Esc (useClickOutside);
 *   - any click inside the panel, so choosing an item closes the menu without each item knowing how.
 *
 * `trigger` is a render function of `open`, so the trigger can show its own open state (e.g. the
 * avatar's accent border) while the shell stays ignorant of what it looks like.
 */
import { useRef, useState, type ReactNode } from "react";
import { useClickOutside } from "../hooks";

export default function Dropdown({
    trigger,
    label,
    children,
    // the panel's width class; a shell, so only the frame size is the caller's
    widthClass = "w-44",
}: {
    trigger: (open: boolean) => ReactNode;
    label: string;
    children: ReactNode;
    widthClass?: string;
}) {
    const [open, setOpen] = useState(false);
    // the wrapper holds BOTH the trigger and the panel, so a press on the trigger isn't "outside" (it
    // toggles instead).
    const wrapperRef = useRef<HTMLDivElement>(null);
    useClickOutside(wrapperRef, () => setOpen(false), open);

    return (
        <div ref={wrapperRef} className="relative">
            <button
                type="button"
                aria-label={label}
                title={label}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((wasOpen) => !wasOpen)}
                className="flex rounded-md"
            >
                {trigger(open)}
            </button>

            {open && (
                <div
                    role="menu"
                    onClick={() => setOpen(false)}
                    className={`absolute right-0 top-full z-40 mt-2 ${widthClass} overflow-hidden rounded-md border border-divider bg-surface py-1 shadow-[var(--shadow-md)]`}
                >
                    {children}
                </div>
            )}
        </div>
    );
}
