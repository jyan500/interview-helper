# Reference brief — sd-tinder: "How would you design a dating app like Tinder?"

## What this question is really testing
Can the candidate build a **low-latency recommendation stack** filtered by location and
preferences, **record swipes and detect a mutual match consistently** (two people swiping right
must reliably produce exactly one match, with no race), and **never re-show an already-swiped
profile** even when a user has swiped on hundreds of thousands of profiles? The three pillars
are feed generation, match consistency, and swipe deduplication. Grade the *reasoning about
consistency and about scale of per-user swipe history*, not vocabulary.

## Concept anchors (demonstrated capability, not keywords)
- **A stack/feed built from geospatial + preference filters**, served fast — which pushes toward
  an indexed store (geospatial index / search engine) and/or **precomputed, cached** stacks with
  a short TTL, refilled in the background.
- **Consistent mutual-match detection.** When A swipes on B, the system must **atomically**
  check whether B already swiped on A and, if so, create the match — with no double-processing.
  The capability is describing an atomic operation (a single-partition transaction, or an atomic
  op in a fast store) rather than "poll for reciprocal swipes."
- **Not re-showing swiped profiles at scale.** A `contains`-check against a growing swipe list
  gets expensive; a **bloom filter** (fast, probabilistic, no false negatives) is the scalable
  answer — and understanding its false-positive tradeoff (occasionally hides an unswiped
  profile, never re-shows a swiped one) is the insight.
- **Using the client** — caching recent swipes locally — to cut server load.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** query the DB with a `WHERE` on age/interests/location per feed load with no
  index; detect matches by periodically polling for reciprocal swipes; filter seen profiles with
  an unbounded in-memory `contains` over the full swipe history.
- **Good (3–4):** an indexed/geospatial feed (or precomputed + cached stacks), swipes recorded
  durably, and a match check inside a transaction; recent-swipe filtering via client cache + DB.
  May not fully close the match race or handle very large swipe histories efficiently.
- **Great (5):** all of Good, **plus** a **provably atomic** match step (co-locate both users'
  swipes in one partition / atomic script so only one match is created), a **bloom filter** for
  swipe dedup at scale with its false-positive tradeoff named, and a hybrid feed
  (precomputed cache for instant serving + indexed store for refills) with a staleness/TTL
  strategy.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** a filtered, indexed feed and recording swipes with a match check is a strong
  answer. Atomicity of the match and bloom-filter dedup are bonus; don't penalize their absence.
- **Mid:** expected to design the feed with real geospatial/preference filtering, record swipes,
  and recognize the duplicate/re-show problem *unprompted*. Should engage with the match race
  when pushed.
- **Senior:** expected to *drive* the depth — guarantee match consistency under concurrent
  swipes, solve swipe dedup at 100k+ history with a bloom filter (and defend its tradeoffs), and
  reason about feed staleness in a precompute-plus-index hybrid. A design that only reaches
  "Good," or where a mutual match can be missed/duplicated, is **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- Precomputed cached stacks (instant serve, but go stale and get exhausted by active users) vs.
  a live indexed/geospatial query (fresh, but heavier per request) — the hybrid uses cache first
  and refills from the index.
- An atomic single-partition transaction for matches (correct, but co-locating swipes can hot-
  spot a partition) vs. an atomic op in a fast in-memory store like Redis (great for real-time
  match detection, but durability rides on a backing store).
- Bloom filter for "already swiped" (O(1), tiny memory, no false negatives) vs. a DB contains
  check (exact, but slow and network-heavy as history grows) — the false-positive rate is
  tunable and the failure mode (hiding an unswiped profile) is acceptable.
- Pushing swipe state to the client (offloads the server) vs. server-authoritative (consistent,
  but more load).
