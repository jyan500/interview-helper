# Reference brief — fe-box-model: "Explain the CSS box model."

## What this question is really testing
A fundamental — the interviewer wants to hear it **internalized, not recited**. The detail that
separates a real answer from a memorized one is `box-sizing`. Grade whether the candidate can
explain the layers *and* the practical gotchas (`box-sizing`, margin collapse).

## Concept anchors (demonstrated capability, not keywords)
- **The four layers, inside out:** content → padding → border → margin.
- **`box-sizing` is the real detail.** With the default `content-box`, a set `width` applies only
  to the content, and padding + border are *added on top* — so a `width: 200px` box with padding
  is wider than 200px. `box-sizing: border-box` folds padding and border into the width, so the
  box is exactly the width you asked for; most codebases set it globally for this reason.
- **Margin collapse** — vertical margins between elements collapse into a single margin rather
  than summing, a classic source of unexpected gaps.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** can't lay out the four layers, or thinks `width` always includes padding/border
  with no notion of `box-sizing`.
- **Good (3–4):** names the four layers correctly and explains `content-box` vs `border-box` and
  why `border-box` is commonly set globally.
- **Great (5):** all of Good, **plus** margin collapse and the instinct that `box-sizing:
  border-box` is the sane default because sizing math otherwise surprises you.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** the four layers plus a correct account of `box-sizing` is a strong answer at this
  level — this is an entry-tagged fundamental. Margin collapse is bonus.
- **Mid:** expected to explain `box-sizing` fluently and know why `border-box` is the common
  default, without prompting.
- **Senior:** expected to have it fully internalized — layers, `box-sizing`, margin collapse —
  and treat it as second nature. Fumbling `box-sizing` is a weak signal at senior.

## Tradeoffs worth crediting when the candidate raises them
- `content-box` (CSS default; intuitive that width = content, but padding/border make the box
  bigger than the stated width) vs. `border-box` (width includes padding/border, predictable
  layout math — why teams set it globally).
