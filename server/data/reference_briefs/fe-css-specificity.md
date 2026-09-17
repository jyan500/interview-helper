# Reference brief — fe-css-specificity: "How does CSS specificity work?"

## What this question is really testing
Can the candidate state the algorithm the browser uses to decide which rule wins — and, more
tellingly, treat **high specificity as a smell rather than a tool**? Grade both the mechanics and
the architectural judgment.

## Concept anchors (demonstrated capability, not keywords)
- **The weight order**, lowest to highest: element/pseudo-element selectors < classes, attribute
  selectors, pseudo-classes < IDs < inline styles; `!important` overrides even those.
- **Tie-breaking by source order** — when specificity is equal, the later rule wins.
- **The mental model** — a tuple roughly `(inline, IDs, classes, elements)` compared left to right.
- **The seniority signal** — high specificity is fragile architecture; reaching for IDs and
  `!important` to win a fight is a smell. Modern tools to *avoid* specificity wars: **`@layer`**
  (cascade layers to control precedence intentionally) and **`:where()`** (wraps selectors at
  zero specificity so they're trivially overridable).

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** can't order the selector types, or reaches for `!important`/IDs as the normal way
  to make a rule win.
- **Good (3–4):** states the weight order and source-order tie-break correctly, and knows
  `!important` is best avoided.
- **Great (5):** all of Good, **plus** treating high specificity as a smell and naming the modern
  escape hatches (`@layer`, `:where()`) and why they exist.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** correctly ordering the selector types and the source-order rule is a solid answer.
  `@layer`/`:where()` are bonus; don't penalize their absence.
- **Mid:** expected to explain the tuple model fluently and know `!important` is a last resort.
- **Senior:** expected to frame high specificity as an architecture smell and reach for `@layer`/
  `:where()` to prevent specificity wars. Treating `!important` as a normal tool is **below bar**
  for senior.

## Tradeoffs worth crediting when the candidate raises them
- Low-specificity, class-based styling (easy to override, maintainable) vs. IDs/`!important`
  (wins the immediate fight, but escalates into fragile specificity wars).
- `@layer` and `:where()` (intentional precedence, trivially overridable) vs. escalating selector
  weight (short-term win, long-term brittleness).
