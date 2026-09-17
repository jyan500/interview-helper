# Reference brief — fe-object-vs-map: "What is the difference between an Object and a Map, and when would you choose each?"

## What this question is really testing
Both store key-value pairs, so the interviewer wants **deliberate choice** — when you'd reach for
one over the other — not just a feature list. Grade the rule-of-thumb reasoning.

## Concept anchors (demonstrated capability, not keywords)
- **Key types** — an Object's keys are strings or symbols (anything else is coerced to a string);
  a Map allows **any value** as a key, including objects and functions.
- **Ergonomics** — a Map preserves insertion order reliably, exposes `.size` directly, and is
  iterable out of the box; an Object needs `Object.keys` and friends. Maps handle frequent
  add/delete better.
- **The prototype gotcha** — Objects carry a prototype, risking key collisions with inherited
  properties (`constructor`, `toString`); Maps have no such risk.
- **The rule of thumb** — a Map for a *dynamic collection*, especially non-string keys or lots of
  churn; an Object for *structured records with a known shape*, and when you need to serialize to
  JSON (Objects map directly; Maps don't).

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** "they're basically the same" or only a superficial syntax difference; no notion
  of when to choose which.
- **Good (3–4):** names the real differences (key types, ordering, `.size`, iterability) and gives
  a sensible when-to-use-each.
- **Great (5):** all of Good, **plus** the prototype/collision gotcha and the JSON-serialization
  point, framed as a clear rule of thumb (dynamic/non-string-keyed → Map; known-shape record or
  JSON → Object).

## Leveling bands — the SAME answer clears a different bar
- **Entry:** listing the key differences and a basic when-to-use-each is a solid answer at this
  level — this is entry-tagged. The prototype and JSON nuances are bonus.
- **Mid:** expected to give the differences fluently and a defensible rule of thumb *unprompted*.
- **Senior:** expected to include the prototype-collision risk and JSON serialization, and to
  frame the choice by workload (churn, key types). "They're the same" is a weak signal at any
  level.

## Tradeoffs worth crediting when the candidate raises them
- Map (any key type, ordered, `.size`, iterable, good for churn; but doesn't serialize to JSON
  directly) vs. Object (known-shape records, direct JSON mapping, familiar; but string/symbol keys
  and prototype-collision risk).
