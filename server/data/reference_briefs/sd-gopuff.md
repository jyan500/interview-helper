# Reference brief — sd-gopuff: "How would you design a local delivery service like Gopuff?"

## What this question is really testing
Can the candidate serve two very different needs from the same system: a **fast, read-heavy
availability query** ("what can be delivered to me within an hour?") that must be low-latency
and tolerant of slight staleness, and a **strongly consistent order path** that must never
oversell limited inventory across nearby distribution centers (DCs)? The crux is
**geospatial filtering of nearby DCs** and **transactional inventory reservation**. Grade the
*split of availability-first reads from consistency-first writes*, not vocabulary.

## Concept anchors (demonstrated capability, not keywords)
- **Finding nearby DCs efficiently.** A naive "compute distance to every DC" or "call a
  travel-time API for every DC" doesn't scale; the capability is a **cheap geospatial
  pre-filter** (a radius / geo-index to a small candidate set) before any expensive
  travel-time check. Awareness that straight-line distance ignores roads/traffic is a plus.
- **Availability query = aggregate inventory across the candidate DCs**, served fast — which
  means caching and/or read replicas because reads vastly outnumber writes.
- **The order path must be atomic.** Placing a multi-item order has to **check-and-reserve
  inventory in a single transaction** so two orders can't both claim the last unit — recognizing
  that this path wants strong consistency while the browse path does not is the core insight.
- **Data locality / partitioning by region** so a query touches one or two partitions, not the
  whole dataset.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** scan all DCs by raw distance on every request; serve availability straight
  from the primary with no caching; place orders without an atomic inventory check, so
  overselling is possible; no regional partitioning.
- **Good (3–4):** a geospatial pre-filter to nearby DCs, an availability read path with caching
  or replicas, and an order path that reserves inventory — possibly with a distributed lock +
  separate stores. May under-explain the race/cleanup risks of that approach.
- **Great (5):** all of Good, **plus** an **atomic single-transaction reserve** (e.g.
  serializable isolation) that provably prevents overselling and reduces failure modes, a
  layered read path (cache with short TTL + read replicas + region partitioning) with an
  invalidation story, and explicit reasoning about why browse is availability-first while order
  is consistency-first.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** a clear availability path (nearby DCs + aggregate inventory) and an order path that
  reserves inventory somehow is a strong answer. The atomicity guarantee and the read-scaling
  layers are bonus; don't penalize their absence.
- **Mid:** expected to design both paths end to end, geo-pre-filter the DC search *unprompted*,
  and recognize that orders need a stronger consistency guarantee than browsing. Should engage
  with the overselling race when pushed.
- **Senior:** expected to *drive* the hard parts — prove the reservation can't oversell, weigh a
  single-transaction reserve against a distributed-lock-plus-cleanup design, and scale the
  read path with caching/replicas/partitioning. A design where overselling is still possible,
  or that only reaches "Good," is **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- Geo pre-filter then travel-time API on the survivors (accurate where it matters, few API
  calls) vs. straight-line distance only (cheap, but ignores real routing) vs. travel-time on
  all DCs (accurate, wasteful).
- Single Postgres transaction with high isolation (atomic, simplest correctness, but couples the
  data and holds locks) vs. separate stores + distributed lock (flexible per-store, but adds
  race/deadlock/cleanup risk).
- Caching availability with a short TTL (throughput, but must invalidate on inventory writes)
  vs. always reading fresh (correct, but hammers the DB) — plus read replicas offloading the
  leader that the order path writes to.
- Region partitioning (query locality, even load) at the cost of cross-region/boundary queries
  needing scatter-gather.
