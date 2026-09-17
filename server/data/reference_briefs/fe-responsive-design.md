# Reference brief — fe-responsive-design: "What are the core principles of responsive design?"

## What this question is really testing
Can the candidate give a **current** (2026, not 2015) account — the classic pillars *plus* the
modern tools that actually changed the game (`clamp()`, container queries)? Grade whether the
answer sounds like it kept up.

## Concept anchors (demonstrated capability, not keywords)
- **Relative units over fixed pixels** — %, `rem`/`em`, viewport units, `fr` in Grid — so layouts
  stretch and shrink instead of breaking.
- **Flexible media** — e.g. `max-width: 100%` so images never overflow their container.
- **Modern layout** — Flexbox and Grid rather than floats.
- **Mobile-first** — base styles for small screens, then layer complexity upward with `min-width`
  queries (easier to add than to unwind).
- **The current-thinking details** — `clamp()` for fluid typography that scales between a min and
  max with no breakpoint, and **container queries**, the real evolution: a component responds to
  the *space it's given* rather than the viewport, so the same card works in a sidebar and a
  full-width hero.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** fixed-pixel layouts with a couple of media-query breakpoints and nothing else; no
  fluid units, no modern layout.
- **Good (3–4):** relative units, flexible media, Flexbox/Grid, and mobile-first with media
  queries — the solid classic answer.
- **Great (5):** all of Good, **plus** `clamp()` for fluid type and **container queries** as the
  real evolution of responsive design, with the viewport-vs-container distinction articulated.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** relative units, flexible images, and media queries is a solid answer. `clamp()` and
  container queries are bonus; don't penalize their absence.
- **Mid:** expected to give the full classic set (fluid units, Flexbox/Grid, mobile-first)
  *unprompted* and ideally gesture at modern tools.
- **Senior:** expected to sound current — `clamp()`, container queries, and *why* container
  queries beat viewport media queries for component reuse. A 2015-era answer is **below bar** for
  senior.

## Tradeoffs worth crediting when the candidate raises them
- Container queries (component responds to its own space, truly reusable) vs. media queries
  (respond to the viewport, so a component must know about the page layout).
- `clamp()` fluid typography (smooth scaling, no breakpoints) vs. stepped breakpoints (simple, but
  jumps at each threshold).
- Mobile-first (`min-width`, additive) vs. desktop-first (`max-width`, subtractive and harder to
  unwind).
