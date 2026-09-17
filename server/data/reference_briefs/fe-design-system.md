# Reference brief — fe-design-system: "What makes a good design system?"

## What this question is really testing
Can the candidate describe a design system as **a product with internal customers**, not just a
component library — and recognize that its real measure is **adoption**? Grade the reasoning
about layering, governance, and why teams actually use (or route around) it.

## Concept anchors (demonstrated capability, not keywords)
- **Design tokens as the single source of truth** — colors, spacing, typography, radii, shadows
  defined once, so a brand change is one edit, not a thousand.
- **Composable, accessible primitives/components** on top of the tokens, with a clear, predictable
  API.
- **The supporting product** — documentation, versioning, and a governance process for how things
  change.
- **Adoption is the real metric** — using the system must be *easier than bypassing it*; a
  beautiful system teams route around is a failed system. Hence developer experience, sensible
  defaults, and accessibility baked in at the primitive level, not bolted on.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** "a shared component library" and nothing more — no tokens, no governance, no
  notion of adoption.
- **Good (3–4):** tokens as the source of truth, accessible reusable components with a clean API,
  plus docs/versioning.
- **Great (5):** all of Good, **plus** the adoption insight — it must be the path of least
  resistance — governance for change, and accessibility/DX baked in at the primitive level. Frames
  the system as a product serving internal customers.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** tokens + reusable accessible components + docs is a solid answer. Governance and the
  adoption framing are bonus; don't penalize their absence.
- **Mid:** expected to describe the layered structure (tokens → primitives → components) and the
  supporting docs/versioning *unprompted*.
- **Senior:** expected to lead with adoption/DX as the real measure, cover governance, and treat
  the system as a product with internal customers. A "component library" answer is **below bar**
  for senior.

## Tradeoffs worth crediting when the candidate raises them
- Tokens as one source of truth (one edit rebrands everything) vs. hardcoded values scattered
  across components (fast today, unmaintainable later).
- Baking accessibility into primitives (correct by default) vs. bolting it on per feature (missed
  and inconsistent).
- Strict/governed system (consistency) vs. flexibility for teams (velocity) — and that a system
  people bypass has failed regardless of how polished it is.
