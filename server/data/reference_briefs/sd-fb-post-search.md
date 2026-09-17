# Reference brief — sd-fb-post-search: "How would you design full-text search over social media posts like Facebook post search?"

## What this question is really testing
Can the candidate build **keyword search over an enormous, fast-growing post corpus** — served
in under ~500ms and sortable by recency or popularity — recognizing that the answer is an
**inverted index** (never a `LIKE` scan), that **ranking/sorting** must be precomputed rather
than done at request time, and that **keeping the index fresh** under high write volume (posts
and likes) is the real scaling challenge? Grade the *reasoning about the index and about the
write/read imbalance*, not vocabulary.

## Concept anchors (demonstrated capability, not keywords)
- **An inverted index**, keyword → list of post ids, built by tokenizing on write — the whole
  point, versus scanning posts with `LIKE` at query time (which scans the corpus per query).
- **Sorting is precomputed, not request-time.** Fetching every matching id and sorting in memory
  is too slow; instead keep **per-sort index structures** — one ordered by recency, a **sorted
  set** ordered by like count — so a query reads an already-ordered slice.
- **Keeping the index fresh under write load.** New posts must be searchable within ~1 minute, so
  writes flow through a **stream (Kafka) + ingestion workers** into a **sharded index**
  (partitioned by keyword hash). Likes are the nastier write problem — a viral post's like count
  changes constantly.
- **Taming like-write volume** — **batching** like updates over a window, or a **logarithmic /
  power-of-2 milestone** update scheme that makes the like index approximate, then a **two-stage
  re-rank** (fetch top N×2, refresh true counts, re-sort) to recover precision.
- **Caching + CDN** for popular queries (no personalization → high hit rate) and index **capping /
  hot-cold tiering** for storage.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** `LIKE '%keyword%'` over the posts table; fetch all matches and sort per request;
  update the like count on every single like; one index that everything hits.
- **Good (3–4):** an inverted index (e.g. in Redis or a search engine), separate precomputed
  indexes for recency and likes, cached results with a short TTL, and a stream-based ingestion
  path. May not shard the index or fully solve the like-write firehose.
- **Great (5):** all of Good, **plus** a **sharded inverted index** (by keyword hash) fed by a
  partitioned ingestion pipeline, a real strategy for **like-write volume** (batching or
  logarithmic milestones) with a **two-stage re-rank** to keep results precise, multi-keyword/
  phrase handling (set intersection, or bigram/shingle indexing), and storage management (index
  capping or hot/cold tiering) with a **CDN + cache** read path.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** reaching for an inverted index instead of a scan, with precomputed sort orders and a
  cache, is a strong answer. Sharding, like-write batching, and two-stage re-ranking are bonus;
  don't penalize their absence.
- **Mid:** expected to design the inverted index and dual sort indexes *unprompted*, keep the
  index fresh via a stream, and recognize the read/write imbalance. Should engage with the
  like-write problem when pushed.
- **Senior:** expected to *drive* the scaling — index sharding, the like-write firehose (batching
  or logarithmic + two-stage re-rank), phrase/multi-keyword queries via intersection or bigrams,
  and storage tiering — proactively. A design resting on `LIKE`, or that only reaches "Good," is
  **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- Inverted index (fast keyword lookup, but storage and write cost, and common keywords make huge
  postings lists) vs. `LIKE` scan (trivial, but scans the corpus per query — a non-starter).
- Separate precomputed indexes per sort order (fast reads) vs. request-time sorting (no extra
  storage, but megabytes of lookups and high latency) — doubling storage buys the speed.
- Logarithmic / power-of-2 like updates (write volume drops exponentially, index becomes
  approximate) plus a two-stage re-rank to recover precision, vs. exact per-like updates (precise,
  but a write storm on viral posts). Batching likes over a window is a simpler middle ground.
- Bigram/shingle indexing for phrases ("Taylor Swift" as one key — fast, but index size explodes)
  vs. set intersection of single-word postings (no extra index, but heavy for common terms).
- Index capping to top-N per keyword (huge storage savings, but old/unpopular posts become
  undiscoverable) vs. hot/cold tiering to blob storage (keeps everything, adds latency for cold
  keywords).
- CDN + cache with short TTL (high hit rate since results aren't personalized) at the cost of
  staleness up to the TTL and invalidation handling.
