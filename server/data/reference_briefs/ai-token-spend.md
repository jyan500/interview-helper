# Reference brief — ai-token-spend: "How do you keep token spend low when working with AI coding agents?"

## What this question is really testing
A cost-awareness question that doubles as a proxy for whether the candidate actually uses these
tools at scale. The dominant lever is **context discipline**; grade the reasoning about *what
wastes spend and how to cut it*, not brand names. Role-agnostic — backend, full-stack, frontend.

## Concept anchors (demonstrated capability, not keywords)
- **Context discipline is the biggest lever** — most waste comes from dumping an entire repo into
  the context window or re-explaining the same background every turn. Give the agent only the
  files that matter for the task at hand.
- **Match the model to the job** — a cheap, fast model for renaming/boilerplate; an expensive one
  reserved for hard reasoning.
- **Scope tasks tightly** so you aren't paying for the agent to wander.
- **Clear/compact context between unrelated tasks** so stale history isn't riding along in every
  request.
- **Spec up front** — a clear prompt that gets it right once is far cheaper than ten cheap prompts
  circling the problem. The maturity line: *a clean prompt with the right three files beats a
  giant context window every time.*

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** no real answer, or "use a cheaper model" as the only lever, with no notion that
  context size is the main cost driver.
- **Good (3–4):** identifies context size as the main cost, curates the files sent, and matches
  model tier to task difficulty.
- **Great (5):** all of Good, **plus** scoping tasks tightly, clearing/compacting context between
  tasks, and investing in a good up-front spec because getting it right once is cheaper than many
  cheap retries — articulating that precision beats a big context window.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** knowing that sending less context and using cheaper models for simple work saves
  money is a solid answer. Context compaction and spec-first economics are bonus; don't penalize
  their absence.
- **Mid:** expected to name context discipline as the primary lever *unprompted* and to match
  models to tasks.
- **Senior:** expected to cover the full toolkit — curated context, model tiering, tight scoping,
  context clearing, and spec-first economics — with the insight that a precise prompt beats a
  huge context window. "Just pick a cheaper model" alone is **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- Minimal curated context (cheap, accurate) vs. dumping the repo (convenient, expensive, noisier
  output).
- Cheap fast model (low cost, weaker reasoning) vs. expensive model (costly, better on hard
  problems) — matched per task rather than one-size-fits-all.
- Investing effort in a spec up front (fewer, cheaper turns) vs. iterating with many cheap prompts
  (feels easy, costs more in aggregate).
- Clearing context between tasks (less waste, but you re-establish context deliberately) vs.
  long-running sessions (convenient, carry stale expensive history).
