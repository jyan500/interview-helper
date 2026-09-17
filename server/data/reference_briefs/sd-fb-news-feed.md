# Reference brief — sd-fb-news-feed: "How would you design a social media news feed like Facebook's?"

## What this question is really testing
Can the candidate reason about the **read-vs-write tradeoff at the heart of every feed** —
do you do the work when a post is *written* (push it into every follower's feed) or when a
feed is *read* (gather posts from everyone they follow)? — and recognize that neither extreme
survives the real world once some accounts have millions of followers? The system is huge
(billions of users), highly read-heavy, and tolerant of ~seconds of staleness. Grade the
*reasoning about where the work goes and why*, not the vocabulary "fan-out."

## Concept anchors (demonstrated capability, not keywords)
- **The fan-out-on-write vs. fan-out-on-read tradeoff**, explained. On write: precompute each
  user's feed so reads are a cheap lookup — great for reads, but a post by a high-follower
  account is a huge write amplification. On read: assemble the feed on demand — cheap writes,
  but a single feed read becomes thousands of sub-queries and blows the latency budget.
- **A precomputed feed store** (a bounded per-user feed, e.g. the most recent N post ids) so
  the common feed read is O(1)-ish, with a fallback for users who page past the precomputed
  window.
- **The celebrity / high-follower problem** and a **hybrid** answer: skip precomputation for
  accounts with enormous follower counts, and *merge* their recent posts in at read time — the
  key insight that neither pure strategy works and the split is by follower count.
- **Serving hot posts** — a viral post is read enormously; a plain sharded cache concentrates
  that load on one shard (the hot-key problem), so the answer needs replication of hot entries
  or another way to spread that read load.
- **Cursor pagination** by timestamp/id (not offset) for an infinite feed.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** "query everyone they follow and sort on every feed load" with no awareness
  that this fans out into thousands of queries; or "push to everyone" with no awareness of
  write amplification for big accounts; no caching; offset pagination on a billion-row feed.
- **Good (3–4):** picks a strategy (usually fan-out-on-write into a precomputed feed) and can
  state its downside, uses a cache and cursor pagination. May not have a real answer for the
  celebrity case or the hot-post read hotspot.
- **Great (5):** all of Good, **plus** a **hybrid** that explicitly handles high-follower
  accounts by merging at read time, an answer to the **hot-key** problem for viral posts
  (replicating hot cache entries / spreading the read), asynchronous fan-out via a queue with
  awareness of the variable per-post work, and honest capacity math (precomputed-feed storage
  across billions of users).

## Leveling bands — the SAME answer clears a different bar
- **Entry:** clearly articulating the write-time vs. read-time tradeoff and picking one with a
  precomputed feed + cache is a strong answer. The celebrity split and hot-key handling are
  bonus; don't penalize their absence.
- **Mid:** expected to choose fan-out-on-write *and name its weakness* unprompted, design the
  precomputed feed and its pagination, and at least identify the high-follower account as a
  problem when prompted.
- **Senior:** expected to *drive* the hybrid design, solve the hot-post read hotspot, reason
  about the async fan-out pipeline and its uneven work, and defend the staleness they're
  willing to accept. A design that only reaches "Good" — no celebrity handling, no hot-key
  answer — is **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- Fan-out-on-write (fast reads, precomputed; expensive, amplified writes for big accounts) vs.
  fan-out-on-read (cheap writes; expensive, high-latency reads) — and the hybrid that uses each
  where it's cheapest.
- A bounded precomputed feed (fast, fixed storage; but paging past the window needs a fallback
  to on-read assembly) vs. an unbounded one (simpler reads, unbounded storage).
- A sharded post cache (even distribution normally, but a viral post creates a single hot
  shard) vs. replicating hot entries across many cache nodes (spreads the read at the cost of N
  times the backing-store writes and more memory).
- Accepting ~seconds of feed staleness to buy availability and cache-ability, an explicit
  consistency relaxation the product allows.
