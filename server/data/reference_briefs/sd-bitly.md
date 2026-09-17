# Reference brief — sd-bitly: "How would you design a URL shortener like Bitly?"

## What this question is really testing
Can the candidate take a deceptively simple product — take a long URL, hand back a short
one, redirect on lookup — and reason about the two things that actually make it hard at
scale: **generating a short code that is unique without coordination-thrashing**, and
**serving the redirect fast** on a read-heavy (roughly 1000:1 reads-to-writes) workload.
There is no single correct design; grade the *mechanism and the tradeoffs*, not whether they
name a specific technology.

## Concept anchors (demonstrated capability, not keywords)
- **A short-code generation scheme that guarantees uniqueness**, and an understanding of
  *why the obvious approaches fail*. Hashing the URL (e.g. base62 of a hash prefix) is
  reasonable but must confront **collisions** (retry + a uniqueness constraint). A monotonic
  **counter, base62-encoded**, sidesteps collisions entirely — the capability is explaining
  *how* the scheme avoids two URLs colliding, not naming "base62."
- **Sizing the code space.** Base62 over ~6-7 characters covers billions of URLs — being able
  to reason that 62^7 comfortably exceeds the 1B target shows they can connect scale to design.
- **The redirect read path.** The lookup is `short_code -> long_url`; an indexed key lookup
  (short_code as primary key) is the baseline, and a **cache in front** (the same code is hit
  far more than written) is what actually meets a sub-100ms redirect at read scale.
- **The redirect itself** — a 301/302 to the original URL — and awareness that the choice
  affects whether the browser caches the redirect (and therefore whether you ever see the
  repeat traffic).

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** a scheme that collides by construction (e.g. "use the first N chars of the
  URL"); no answer to how two different URLs stay distinct; no notion that reads dominate, so
  no read-path optimization at all.
- **Good (3–4):** a generation scheme that is actually unique (hash + collision handling, or a
  counter), an indexed lookup keyed on the short code, and a cache to make the redirect fast.
  May not size the code space precisely or reason about counter coordination.
- **Great (5):** all of Good, **plus** reasoning about **how the counter stays unique across
  many app servers** (a central atomic counter, or handing each server a pre-allocated block
  of ids to avoid a per-request round trip), the **enumeration/security tradeoff** of
  sequential codes vs. the collision cost of hashes, and where caching lives (app-tier cache
  vs. CDN/edge for globally popular links), with the read/write asymmetry named explicitly.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** a correct *single-service* design — a unique-by-construction code, an indexed
  lookup, and the instinct to cache hot redirects — is a strong answer. Distributed counter
  coordination and edge caching are bonus, not expected; do not penalize their absence.
- **Mid:** expected to raise the read/write asymmetry *unprompted*, pick a defensible
  generation scheme and defend it against collisions, and gesture at how the id scheme behaves
  once there is more than one server.
- **Senior:** expected to *drive* the tradeoffs — coordination-free id allocation, the
  enumeration risk, cache/CDN placement and invalidation, and capacity math that ties the code
  length to the target scale. A design that only reaches "Good" is **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- Hash-based codes (dedupe identical URLs for free, but must handle collisions) vs. a counter
  (never collides, but codes are guessable/enumerable and need distributed coordination).
- A central atomic counter (simple, one dependency, a round trip per write) vs. pre-allocated
  id ranges per server (no per-write coordination, but ids are non-contiguous and a server
  crash wastes a block).
- 301 (permanent, browser caches it, cheaper repeat traffic, but you lose analytics and can't
  change the target) vs. 302 (every hit reaches you, at the cost of the extra request).
- App-tier cache (simple, per-region) vs. CDN/edge redirects (near-user latency for viral
  links, at the cost of invalidation complexity when a mapping changes or expires).
