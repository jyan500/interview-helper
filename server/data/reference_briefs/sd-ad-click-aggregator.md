# Reference brief — sd-ad-click-aggregator: "How would you design a real-time ad click aggregator?"

## What this question is really testing
Can the candidate ingest a **high-throughput click stream**, aggregate it into **near-real-time,
queryable metrics** at minute granularity, and — because this is billing/analytics — guarantee
**no lost clicks and no double counting** (idempotency) plus a path to **correctness**
(reconciliation)? The pillars are stream ingestion + real-time aggregation, exactly-once/
idempotency, and fast analytical queries. Grade the *reasoning about the streaming pipeline and
about correctness under retries/failures*, not vocabulary.

## Concept anchors (demonstrated capability, not keywords)
- **Capture the click reliably, then aggregate off the hot path.** A **server-side redirect**
  through a `/click` endpoint (302 to the advertiser) ensures the click is recorded (client-only
  tracking can be bypassed), and the event goes into a **durable stream** (Kafka/Kinesis) rather
  than straight into an analytics DB.
- **Real-time aggregation via stream processing.** A processor (e.g. **Flink**) maintains
  **windowed state** and flushes per-minute aggregates to an **OLAP store**, instead of running
  `GROUP BY` over raw events at query time. Understanding *why* pre-aggregation is required for
  sub-second queries is the insight.
- **Idempotency / exactly-once.** Each click carries a **unique (ideally signed) impression id**;
  the processor dedups (e.g. a Redis check) so retries don't double count — and the pipeline uses
  **checkpointing + stream replication/retention** so a crash resumes without loss.
- **Correctness backstop.** A **batch reconciliation** (re-aggregate raw events from a data lake
  and compare) — the lambda-architecture blend of a fast speed layer and a correct batch layer.
- **Hot-shard handling** — a viral advertiser floods one partition; split with a random suffix
  and merge on write.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** write clicks to a DB and `GROUP BY` at query time; client-side-only click
  tracking; no dedup, so retries double count; no story for a processor crash losing data.
- **Good (3–4):** a durable stream, aggregation (even if batch/periodic) into an OLAP store for
  fast queries, server-side click capture, and some dedup. May accept minutes-old metrics and
  under-specify exactly-once or hot shards.
- **Great (5):** all of Good, **plus** **real-time stream processing** with windowed state and
  per-minute flushes, **exactly-once/idempotency** via signed impression ids + dedup +
  checkpointing (with the "write to stream first, then cache" ordering reasoned about), a
  **reconciliation batch** as the correctness source of truth, and a **hot-shard** mitigation —
  with multi-level pre-aggregation (minute → day → month) for query latency.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** recognizing that querying raw events won't scale and proposing a stream +
  pre-aggregation into an analytics store is a strong answer. Exactly-once, reconciliation, and
  hot shards are bonus; don't penalize their absence.
- **Mid:** expected to design the pipeline end to end (capture → stream → aggregate → OLAP query)
  *unprompted* and recognize the double-counting/idempotency problem. Should weigh batch vs.
  real-time aggregation when pushed.
- **Senior:** expected to *drive* correctness — exactly-once semantics, checkpointing and stream
  retention for no data loss, a reconciliation layer, and hot-shard handling — and justify the
  technology choices. A design that can lose or double-count clicks, or only reaches "Good," is
  **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- Server-side redirect (captures every click, adds a hop of latency) vs. client-side tracking
  (no added latency, but bypassable and lossy).
- Batch pre-aggregation (simple, robust, but metrics are minutes stale and spiky) vs. real-time
  stream processing (near-instant metrics, exactly-once windowing, but more operational
  complexity) — the lambda blend uses batch as the correctness backstop behind the fast layer.
- Dedup ordering "write to stream first, then mark in cache": occasional duplicates are caught by
  reconciliation, but a lost click can't be recovered — so favor not losing over not duplicating.
- Hot-shard split via random suffix on the ad id (spreads a viral advertiser across sub-
  partitions, merged with SUM on write) at the cost of extra merge logic.
- Columnar OLAP (Snowflake/BigQuery/ClickHouse) for fast SUM/COUNT over millions of rows, vs.
  time-series DBs which fit poorly given millions of ad ids and multi-dimensional slicing.
