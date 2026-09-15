/**
 * The one button in the app. Wraps the design-system `.btn` classes (ported into index.css) so every
 * button is one component instead of a hand-written `className="btn btn-…"` at each call site.
 *
 * `variant` picks the theme:
 *   - primary   — accent (purple) border + text; the main call to action.
 *   - secondary — neutral divider border, default ink text.
 *   - ghost     — no border, accent text, tight padding; for inline / low-emphasis actions.
 *
 * `icon` makes it a square icon-only button; `block` stretches it full width. Everything else
 * (type, onClick, disabled, aria-*, style, extra className for sizing/layout) passes straight through
 * to the underlying <button>. `children` can be text, an icon, or both.
 *
 * Note `type` defaults to "button": form-submit buttons must opt in with type="submit" explicitly, so
 * a bare <Button> can never accidentally submit a surrounding form.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    icon?: boolean;
    block?: boolean;
    children?: ReactNode;
}

export default function Button({
    variant = "primary",
    icon = false,
    block = false,
    type = "button",
    className = "",
    children,
    ...rest
}: ButtonProps) {
    const classes = ["btn", `btn-${variant}`, icon && "btn-icon", block && "btn-block", className]
        .filter(Boolean)
        .join(" ");

    return (
        <button type={type} className={classes} {...rest}>
            {children}
        </button>
    );
}
