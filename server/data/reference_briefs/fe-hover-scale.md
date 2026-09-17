# Reference brief — fe-hover-scale: "Build a button that scales up on hover, efficiently."

## What this question is really testing
The word doing the work is **efficiently**. Anyone can write `:hover { transform: scale(1.05); }`
— the interviewer wants to know whether the candidate understands *why* that's the right answer
and *what the wrong answers cost* at the level of the browser's rendering pipeline. Grade the
reasoning about the pipeline and the compositor, not the one-liner.

## Concept anchors (demonstrated capability, not keywords)
- **Animate `transform` (and/or `opacity`), with a `transition`.** These are the only two
  properties the browser can animate on the **compositor thread** without triggering layout or
  paint — so the animation stays smooth.
- **Why the wrong approaches cost** — animating `width`/`height`/`margin`/`padding` forces the
  browser to recalculate **layout (reflow)** and **repaint** every frame, producing janky,
  stuttering hovers.
- **The rendering pipeline** — layout → paint → composite — and that `transform` skips the first
  two stages.
- **Accessibility + hints** — respecting `prefers-reduced-motion`, and that `will-change` can
  promote the element to its own layer but costs memory and should be used sparingly.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** animates a layout-triggering property (width/height/margin) or toggles size with
  no transition; no awareness that this causes reflow/repaint jank.
- **Good (3–4):** uses `transform: scale()` with a `transition` and can say it avoids layout —
  the correct answer, correctly justified.
- **Great (5):** all of Good, **plus** walking the layout→paint→composite pipeline and naming the
  compositor thread, plus `prefers-reduced-motion` for accessibility and a measured note on
  `will-change` (helpful hint, memory cost, use sparingly).

## Leveling bands — the SAME answer clears a different bar
- **Entry:** reaching for `transform: scale()` with a transition, and knowing it's smoother than
  animating size, is a solid answer. The pipeline detail is bonus; don't penalize its absence.
- **Mid:** expected to justify the choice via layout/paint/composite *unprompted* and know which
  properties are compositor-only.
- **Senior:** expected to explain the pipeline crisply, cover `prefers-reduced-motion` and
  `will-change`'s tradeoff, and — in an AI-agent context — say they'd catch an agent animating
  `width` and correct it. Just "use transform" with no reasoning is **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- `transform`/`opacity` (compositor-only, cheap, smooth) vs. layout properties (reflow + repaint
  every frame, janky).
- `will-change` promotes to its own layer (smoother) at the cost of memory — a hint, not a habit.
- Respecting `prefers-reduced-motion` (accessibility) vs. always animating (can harm users
  sensitive to motion).
