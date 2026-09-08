/**
 * Small, dependency-free UI helpers shared across pages. Pure functions only — no React, no
 * network, no module state — so they're trivial to reuse and to reason about.
 */

/**
 * Two-letter initials for an avatar, derived from a display name or, failing that, an email.
 *   "Jane Yan"        -> "JY"   (first letter of the first two words)
 *   "jyan500@..."     -> "JY"   (first two characters, when there's only one token)
 *   "" / undefined    -> "You"  (never render a blank avatar)
 */
export function initialsFrom(name?: string, email?: string): string {
    const src = (name || email || "").trim();
    if (!src) return "You";
    const parts = src.split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return src.slice(0, 2).toUpperCase();
}
