# Reference brief — ai-code-quality: "How do you keep code quality high when a lot of your code is AI-generated?"

## What this question is really testing
Does the candidate understand that AI **doesn't lower or raise quality — it raises the volume
of code**, and that volume is what breaks weak quality systems? The strong answer is about the
*system*, not willpower. Grade the reasoning about automated gates and the shifted bottleneck,
not tool names. Role-agnostic — applies to backend, full-stack, and frontend engineers.

## Concept anchors (demonstrated capability, not keywords)
- **Automated gates first** — strict types (e.g. TypeScript), linting/formatting, and a real
  test suite in CI, so AI-generated code clears exactly the same bar as human-written code.
- **Small, reviewable pull requests** — a diff you can't review is a diff you can't vouch for.
- **Conventions encoded where the agent can read them**, so generated code matches house style
  by default.
- **A firm rule: don't merge code you don't understand.**
- **The shifted-bottleneck insight** — when writing code was slow, that was the constraint; now
  generation is nearly free, so *review* is the constraint, and fast automated feedback is what
  keeps a team fast.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** relies on personal diligence / "I just read it carefully"; no automated gates;
  treats AI code as trusted; would merge large diffs on a green-looking result.
- **Good (3–4):** names automated gates (types, lint, tests, CI) applied equally to AI code,
  small reviewable PRs, and the don't-merge-what-you-don't-understand rule.
- **Great (5):** all of Good, **plus** the *why* — AI raises volume, volume breaks weak systems,
  so invest in the system; conventions encoded for the agent; and the articulation that review
  is now the bottleneck, so fast automated feedback (not a human bottleneck) is the goal.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** "run the same tests and linting on it, review it before merging" is a solid answer.
  The volume/bottleneck framing is bonus; don't penalize its absence.
- **Mid:** expected to describe the automated-gates system *unprompted* and treat AI code as
  needing the same bar as human code.
- **Senior:** expected to reframe the problem (volume, not quality), explain why review is the
  new constraint, and describe encoding conventions + fast feedback so quality scales with
  volume. An answer resting on willpower/careful-reading is **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- Automated gates (scale to any volume, consistent) vs. manual vigilance (doesn't scale, breaks
  under AI's output rate).
- Small PRs (reviewable, slower to assemble) vs. large generated diffs (fast to produce,
  unreviewable).
- Encoding conventions for the agent (up-front effort) vs. correcting style every review (ongoing
  cost).
- Investing in fast CI/feedback so the human isn't the bottleneck — speed and quality reinforcing
  rather than trading off.
