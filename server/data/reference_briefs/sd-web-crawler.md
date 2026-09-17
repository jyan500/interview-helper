# Reference brief — sd-web-crawler: "How would you design a large-scale web crawler?"

## What this question is really testing
Can the candidate design a **fault-tolerant, polite, and efficient** pipeline that crawls
billions of pages within a time budget — resuming without losing progress after failures,
respecting robots.txt and not hammering any one domain, and avoiding re-crawling URLs and
duplicate content? The pillars are the URL frontier + fault tolerance, politeness, and
dedup/efficiency at scale. Grade the *reasoning about a resumable pipeline and about not doing
redundant or abusive work*, not vocabulary.

## Concept anchors (demonstrated capability, not keywords)
- **A durable frontier + staged pipeline.** URLs to crawl live in a **durable queue**, and the
  stages (fetch → parse → extract links → store) are separated so a failure in one is isolated
  and progress survives a crash — with **metadata tracking** which URLs are fetched/processed so
  work isn't lost or repeated.
- **Fault tolerance with backoff.** Transient failures **retry with exponential backoff** (e.g.
  a queue's visibility timeout / dead-letter after N tries), rather than an in-memory sleep that
  dies with the process.
- **Politeness.** Respect **robots.txt** and enforce a **per-domain rate limit / crawl-delay**
  (per-domain lock + a delay), plus global rate limiting with jitter to avoid thundering herd —
  recognizing that ignoring this gets you blocked and is abusive.
- **Dedup at scale + trap avoidance.** A **bloom filter** for "URL/content already seen" (O(1),
  probabilistic, avoids a DB lookup per URL), and a **max-depth** limit to escape crawler traps
  and cycles. Plus **DNS** as a real bottleneck (caching / multiple resolvers) and enough
  **parallelism** to hit the page-count SLA.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** a single machine looping over URLs; in-memory retry that loses state on crash;
  no robots.txt or per-domain limiting; sequential `contains` checks against a store for dedup;
  no depth limit, so it loops forever in traps.
- **Good (3–4):** a queue-based frontier with a multi-stage pipeline, metadata tracking of seen
  URLs, retry with backoff, robots.txt compliance with per-domain delays, and hash-based dedup
  in a DB. May under-address DNS, thundering herd, or dedup cost at web scale.
- **Great (5):** all of Good, **plus** a **bloom filter** for URL/content dedup (avoiding a DB
  hit per URL, with its false-positive tradeoff named), an **atomic per-domain lock + global
  rate limit with jitter** for politeness, **max-depth** trap escaping, **DNS** mitigation
  (caching / multiple providers), and rough **capacity math** (pages/sec per machine × N
  machines vs. the deadline) showing the SLA is met.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** a queued frontier, a fetch/parse/store pipeline, and awareness of robots.txt and
  not re-crawling is a strong answer. Bloom-filter dedup, DNS, and capacity math are bonus;
  don't penalize their absence.
- **Mid:** expected to design a durable, resumable pipeline *unprompted*, handle retries with
  backoff, and implement per-domain politeness. Should engage with dedup cost and traps when
  pushed.
- **Senior:** expected to *drive* the efficiency and scale — bloom-filter dedup, distributed
  politeness (locks + rate limiting + jitter), DNS bottleneck, trap avoidance, and capacity math
  proving the deadline. A design that isn't resumable, isn't polite, or only reaches "Good," is
  **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- A managed queue with visibility-timeout retries + dead-letter (managed, resilient) vs.
  hand-rolled backoff on a separate failed-URL topic (flexible, more to build) vs. in-memory
  retry (trivial, loses state on crash).
- Bloom filter for dedup (O(1), tiny memory, avoids DB reads; accepts rare false positives that
  skip a URL) vs. indexed hash lookups in a DB (exact, but a read per URL at web scale).
- Politeness via per-domain lock + crawl-delay (well-behaved, one point of contention per
  domain) vs. ignoring it (fast, but gets you blocked and is abusive).
- More crawler machines / parallelism (meets the deadline) but DNS and per-domain limits become
  the real ceilings, so bandwidth alone isn't the whole story.
- Max-depth cutoff (escapes traps and infinite loops) at the cost of possibly missing deep-but-
  legitimate pages.
