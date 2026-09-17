# Reference brief — sd-top-k: "How would you design a service that returns the top-K most-viewed videos over a time window?"

## What this question is really testing
Can the candidate handle a **massive write stream** (hundreds of thousands of view events per
second) and still answer **top-K over a time window in tens of milliseconds** — recognizing
that you cannot compute the answer from raw events at query time, and that the design lives or
dies on **pre-aggregation** and **stream processing**? The hard tension is throughput vs. query
latency vs. exactness. Grade the *reasoning about aggregating the stream and precomputing the
answer*, not vocabulary.

## Concept anchors (demonstrated capability, not keywords)
- **You can't scan raw events per query.** The read must hit a **precomputed / pre-aggregated**
  result (a warmed cache of the current top-K, or dedicated per-window aggregate tables), not a
  `SUM ... GROUP BY ... ORDER BY` over billions of rows.
- **Taming the write throughput.** Every view can't be a single indexed DB write; the answer is
  a **partitioned stream (Kafka by videoId)** feeding a **stream processor (e.g. Flink)** that
  **batches/aggregates** counts per video per window, cutting writes by orders of magnitude.
- **Windowing.** Maintaining per-window aggregates (last hour/day/month), and — for sliding
  windows — an increment/decrement scheme (add new counts, subtract counts that aged out) rather
  than recomputing from scratch.
- **Exact vs. approximate.** Awareness that exact top-K over billions of keys is expensive, and
  that a **count-min sketch + heap** trades bounded memory for approximate counts — a legitimate
  design lever, with its accuracy tradeoff named.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** query the events table (or an index) on every request and sort; one DB node
  taking every view as a write; recompute each window from raw data. Collapses at the stated
  throughput and blows the latency SLA.
- **Good (3–4):** cache the top-K with a short TTL, shard the write path (partition by videoId,
  shard the DB), and pre-aggregate to coarser grains. May rely on expensive periodic aggregation
  crons and not fully solve sliding windows or write amplification.
- **Great (5):** all of Good, **plus** a **stream processor that aggregates in-flight** (Flink
  batching per window, checkpointed for recovery), **dedicated per-window aggregate tables** or
  an OLAP store queried by a cron that warms the cache before expiry, a real **sliding-window**
  scheme (increment/decrement, e.g. dual consumer groups), and a considered stance on
  **exact vs. count-min-sketch** approximation with memory math.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** recognizing that raw-event queries won't work and proposing pre-aggregation + a
  cached top-K is a strong answer. Stream processing, sliding windows, and sketches are bonus;
  don't penalize their absence.
- **Mid:** expected to design an end-to-end pipeline (stream → aggregate → store → cached query)
  and shard the write path *unprompted*, with some bottlenecks identified. Should engage with
  windowing when pushed.
- **Senior:** expected to *drive* the depth — a checkpointed stream processor, per-window
  aggregates, sliding-window increment/decrement, the hot-key problem, and the exact-vs-sketch
  tradeoff with capacity reasoning. A design that only reaches "Good," or still touches raw
  events on the read path, is **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- Query-time aggregation (always fresh, but far too slow at scale) vs. precomputed aggregates +
  warmed cache (fast reads, but staleness up to the refresh interval and extra write/ops load).
- One DB per write (simple, collapses at ~10k TPS/node) vs. partition-by-videoId sharding
  (parallel, but results must be merged) vs. stream batching in Flink (huge write reduction, but
  adds a processing tier and checkpointing).
- Exact counts (correct, but full state for billions of keys = large memory/storage) vs. count-
  min sketch + heap (bounded memory, approximate, tunable error) — acceptable when "top-K" can
  tolerate small ranking noise.
- Sliding window via increment/decrement or dual consumer groups (avoids recompute, needs
  retention of aged data) vs. tumbling windows (simpler, coarser).
- Specialized stores (Druid/Pinot/ClickHouse rollups) fit; high-cardinality time-series DBs
  (InfluxDB/Prometheus) do not, because billions of video ids as tags break top() queries.
