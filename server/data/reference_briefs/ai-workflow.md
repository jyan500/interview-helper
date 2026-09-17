# Reference brief — ai-workflow: "Beyond basic prompting, what does your AI-assisted development workflow look like?"

## What this question is really testing
Does the candidate use an AI agent as fancy autocomplete, or have they actually **rebuilt how
they ship** around it — with deliberate context, a plan, a tight review loop, and guardrails?
There is no single "correct" workflow; grade the *judgment and the guardrails*, not tool names.
This question is role-agnostic — it applies to a backend, full-stack, or frontend engineer alike.

## Concept anchors (demonstrated capability, not keywords)
- **Deliberate context management** — feeding the agent the relevant files, type definitions,
  design system, and house conventions (often via a rules/config file the tool reads) rather
  than hoping it guesses.
- **Spec-first** — writing a short plan/target before generating, so the agent codes against a
  clear spec instead of wandering.
- **A tight feedback loop** — small, reviewable diffs, not thousand-line dumps.
- **A clear division of labor** — letting AI own the tedious ~80% (boilerplate, mechanical
  refactors, test scaffolding) while the human owns architecture and the hard 20%.
- **Guardrails** — types, tests, linting/CI so nothing merges just because it looks plausible —
  and the maturity to know *when not to reach for the agent at all*.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** "I paste the error and ask it to fix the error until it works" — no context
  discipline, no plan, no review habit. A slot machine, not a workflow.
- **Good (3–4):** names several real practices — curating context, reviewing diffs, running
  tests/linting on generated code — and treats AI output as something to verify, not trust.
- **Great (5):** all of Good, **plus** a coherent *system*: spec-first planning, deliberate
  context (rules file / relevant files only), small diffs, an explicit human-owns-architecture
  split, guardrails wired into CI, and knowing when the agent is the wrong tool.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** describing a basic but honest loop — give it context, review what it writes, run
  tests — is a solid answer. A fully rebuilt spec-first process is bonus; don't penalize its
  absence.
- **Mid:** expected to describe several deliberate practices *unprompted* (context curation,
  reviewable diffs, guardrails) and to reject the paste-the-error anti-pattern.
- **Senior:** expected to articulate the whole system and the *why* — spec-first, the 80/20
  ownership split, guardrails as the thing that lets generation stay fast, and judgment about
  when to skip the agent. An answer that's just "I prompt and check it" is **below bar** for
  senior.

## Tradeoffs worth crediting when the candidate raises them
- Curated, minimal context (cheaper, more accurate) vs. dumping the whole repo (convenient, but
  noisier and worse output).
- Small diffs (reviewable, safe) vs. large generations (faster to produce, impossible to vouch
  for).
- Letting AI own boilerplate while the human owns architecture — recognizing which 20% must stay
  human-driven.
- Knowing when *not* to use the agent — some problems are faster or safer to reason through
  directly.
