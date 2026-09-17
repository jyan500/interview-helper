# Reference brief — fe-weakmap-gc: "Explain the difference between Map and WeakMap, and how garbage collection fits in."

## What this question is really testing
The memory-awareness question — can the candidate explain **strong vs weak references** and how
JavaScript's garbage collector reclaims memory, and tie it to a real use case? Grade the GC
reasoning, not the API surface.

## Concept anchors (demonstrated capability, not keywords)
- **Mark-and-sweep GC** — starting from roots (globals, the current call stack), the collector
  marks everything reachable and sweeps the rest; an object with no references becomes eligible
  for collection.
- **Map holds keys strongly** — as long as the Map exists, its keys can't be collected even if
  the rest of the code has forgotten them. Forgetting to `delete` entries from a long-lived Map is
  a classic **memory leak**.
- **WeakMap holds keys weakly** (keys must be objects) — if the only reference to a key object is
  the WeakMap, the GC may reclaim it and the entry simply vanishes.
- **Why WeakMap isn't iterable and has no `.size`** — entries can disappear at any moment, so
  there'd be no consistent answer.
- **The tying use case** — associating extra data with an object (DOM-node metadata, a per-instance
  private cache) without keeping that object alive; the data lives exactly as long as the object.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** "WeakMap is a Map with weak stuff" — no grasp of references or GC; can't say why
  it isn't iterable.
- **Good (3–4):** strong vs weak references, that a WeakMap's key can be GC'd when otherwise
  unreferenced, and object-only keys — with a basic use case.
- **Great (5):** all of Good, **plus** mark-and-sweep from roots, the long-lived-Map memory-leak,
  *why* WeakMap has no `.size`/iteration (entries vanish nondeterministically), and the metadata/
  private-cache use case articulated cleanly.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** grasping that a WeakMap lets its keys be garbage-collected while a Map doesn't is a
  reasonable answer — but this is a senior-tagged question, so that's the floor, not the target.
- **Mid:** expected to explain strong vs weak references and object-only keys with a use case.
- **Senior:** expected to explain mark-and-sweep, the Map memory-leak, why WeakMap can't be
  iterated or sized, and the metadata/cache use case — the full memory model. This is where the
  question is aimed.

## Tradeoffs worth crediting when the candidate raises them
- Map (iterable, `.size`, entries persist — but pins its keys in memory, a leak risk for
  long-lived maps) vs. WeakMap (auto-cleans with its keys, no leak — but not iterable, no `.size`,
  object keys only).
- Using a WeakMap for object-associated metadata/caches (data lifecycle matches the object) vs. a
  Map (must remember to `delete`, or leak).
