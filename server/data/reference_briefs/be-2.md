# Reference brief — be-2: "How would you design a rate limiter for a public API?"

> **This is the worked exemplar for Phase E.** It shows the shape every other brief should
> take: what the question tests, capability-phrased concept anchors, a bad/good/great
> gradation, and per-level bars. Author the rest (`be-1`, `be-3`, `pm-1`, `pm-2`, …) to match.
> Keep anchors phrased as *demonstrated capability*, never keywords — the grader is told to
> reward understanding, so "says token bucket" must not be worth points on its own.

## What this question is really testing
Can the candidate turn a vague goal ("stop abuse / protect the API") into a concrete
mechanism, reason about **where it runs** and **how it holds state across many servers**, and
name the **tradeoffs** of their choice? There is no single correct design — grade the
*reasoning*, not the vocabulary.

## Concept anchors (demonstrated capability, not keywords)
- **A concrete algorithm, explained.** Token/leaky bucket (refills at the allowed rate, lets a
  client spend a burst up to the bucket size), fixed window (cheap, but allows a 2× spike at the
  window boundary), or sliding window (accurate, more memory). Naming an algorithm earns nothing;
  explaining *how it decides to allow or reject a request* is the capability.
- **What the limit is keyed on** — per API key / per user / per IP — and why the key matters
  (shared NAT IPs punish many users at once; keys can rotate).
- **Where the counter lives so it survives multiple app servers** — a shared store (e.g. Redis)
  vs per-instance memory, and the insight that per-instance counters *undercount* behind a load
  balancer (each server sees only its slice of traffic).
- **What a rejected request gets** — HTTP 429 with `Retry-After`, and ideally `X-RateLimit-*`
  headers so clients can back off instead of hammering.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** an algorithm named with no mechanism ("I'd use Redis to rate limit"); no answer
  to multi-server state; no key choice; no defined reject behavior.
- **Good (3–4):** one algorithm whose mechanism is explained correctly, keyed per client, counter
  in a shared store, returns 429. May miss atomicity or the burst-vs-smoothness nuance.
- **Great (5):** all of Good, **plus** reasons about the **atomicity** of check-and-decrement (a
  race between servers → an atomic op / Lua script), the **burst vs smoothness** tradeoff of the
  chosen algorithm, the **store-down failure mode** (fail-open vs fail-closed), and **cost/accuracy**
  (sliding-log memory vs fixed-window boundary error).

## Leveling bands — the SAME answer clears a different bar
- **Entry:** a correct *single-machine* mechanism (an algorithm explained + a 429) is a strong
  answer. Distributed state and atomicity are bonus, not expected — do not penalize their absence.
- **Mid:** expected to raise the shared-store / multi-server point *unprompted* and pick a sensible
  key. Should at least gesture at atomicity when pushed.
- **Senior:** expected to *drive* the tradeoff conversation — atomicity, fail open/closed, burst
  smoothing, and where the limiter sits (edge/gateway vs app). An answer that only reaches "Good"
  is **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- Token bucket allows bursts; leaky bucket enforces a smooth rate — which you want is API-specific.
- Fixed window is cheap but permits a boundary burst; sliding window fixes that at higher memory/CPU.
- Centralized store (accurate, adds latency + a dependency) vs local approximate limits (fast, drifts) —
  mature systems often layer both.
- Fail-open (availability over protection) vs fail-closed (protection over availability) when the
  limiter's store is unreachable.
