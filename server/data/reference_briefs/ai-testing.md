# Reference brief — ai-testing: "How do you test AI-generated code?"

## What this question is really testing
Does the candidate hold to sound testing philosophy — **test behavior, not implementation** —
and recognize the specific trap that AI will happily write tests that pass trivially, mirror the
implementation, or only exercise a mock, giving a green checkmark and no real safety? Grade the
*philosophy and the awareness of AI's testing failure modes*, not tool names. Role-agnostic.

## Concept anchors (demonstrated capability, not keywords)
- **Test behavior, not implementation** — the core principle doesn't change because AI wrote the
  code.
- **Use AI where it's genuinely good** — generating test scaffolding and suggesting edge cases a
  human would forget — while staying alert to its failure mode.
- **The trap:** AI-written tests that pass trivially, just mirror the code, or only test a mock —
  coverage theater, not safety.
- **A layered test strategy** — unit tests for pure logic, component/integration tests for
  user-visible behavior, and end-to-end tests for the few flows that would be disastrous if
  broken — and that **coverage percentage is not quality** (90% covered can still be tested
  badly).
- **The senior framing:** the human decides what "correct" means; tests are the *specification*
  the AI codes against — a sloppy spec yields confidently-wrong code.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** "have the AI write the tests and check they pass" — trusts AI-generated tests
  wholesale; chases a coverage number; no notion of trivial/mock-only tests giving false safety.
- **Good (3–4):** tests behavior over implementation, uses AI for scaffolding/edge cases but
  reviews the tests, and describes a layered strategy (unit / integration / e2e).
- **Great (5):** all of Good, **plus** naming the specific AI test traps (trivial passes,
  implementation-mirroring, mock-only), rejecting coverage % as a quality proxy, and the framing
  that the human owns the definition of correct and the tests are the spec the AI builds to.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** "test the behavior, and review the tests the AI writes rather than trusting them"
  is a solid answer. The layered strategy and the spec framing are bonus; don't penalize their
  absence.
- **Mid:** expected to state test-behavior-not-implementation *unprompted*, describe the test
  layers, and show awareness that AI tests can be hollow.
- **Senior:** expected to articulate the AI-specific failure modes, dismiss coverage-as-quality,
  and own the "tests are the specification" framing. Trusting AI tests because they're green is
  **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- Testing behavior (survives refactors, catches real regressions) vs. testing implementation
  (brittle, and exactly what a lazy AI test does).
- Using AI to surface edge cases (real value) vs. letting it author the whole suite unreviewed
  (false safety).
- The test pyramid — many cheap unit tests, fewer integration, a handful of e2e for critical
  flows — vs. chasing a coverage number that says nothing about quality.
