# Reference brief — sd-ticketmaster: "How would you design a ticket-booking system like Ticketmaster?"

## What this question is really testing
Can the candidate recognize that this system has **two workloads with opposite priorities** —
browsing/searching events wants *availability* and can tolerate slightly stale data, but
booking a seat demands *consistency* (never sell the same seat twice) — and design each
accordingly? The centerpiece is **concurrency on a scarce resource**: many users racing for
the same seat during a popular on-sale. Grade the *reasoning about correctness under
contention*, not vocabulary.

## Concept anchors (demonstrated capability, not keywords)
- **A booking scheme that prevents double-booking**, explained as a mechanism. The naive
  instinct — hold a database row lock for the whole checkout — must be recognized as *wrong*
  (locks held for a human's multi-minute checkout starve the DB and strand state on a crash).
  A credible answer introduces a **reservation with an expiry**: a seat goes AVAILABLE ->
  RESERVED (with a TTL) -> BOOKED, so an abandoned cart frees the seat automatically.
- **How the reservation is made atomic** so two requests can't both win — a single short
  transaction that checks "available, or reserved-but-expired" and flips it, or a
  **distributed lock with a TTL** (e.g. in Redis) keyed on the seat, with the database as the
  final source of truth.
- **Separating the read path from the write path** — event/venue/seat-map browsing served from
  caches and read replicas (availability-first), booking served by a consistent transactional
  path (consistency-first). Naming *why* they're split is the capability.
- **Search** as its own concern — keyword/date/location lookup backed by a search index
  (inverted index / full-text) rather than `LIKE` scans over the primary DB.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** "lock the row until they pay" with no awareness of the hold-time problem; no
  expiry on reservations; no separation of browsing from booking; double-booking is possible
  in the described design.
- **Good (3–4):** a reservation model with a status field and an **expiry** so held seats are
  released, browsing separated from booking, and search that doesn't table-scan. May rely on a
  periodic cron to expire reservations (with the lag that implies) and may not fully close the
  atomicity race.
- **Great (5):** all of Good, **plus** an **atomic** reserve step that provably lets only one
  request win (single-statement conditional update, or a TTL lock with the DB as backstop),
  and handling of the **on-sale thundering herd** — a **virtual waiting queue** that admits
  users in controlled batches instead of letting 10M users hit the seat map at once — plus how
  live seat-availability updates reach browsers (SSE/websockets) and how search stays fast
  (dedicated search engine, CDC-synced).

## Leveling bands — the SAME answer clears a different bar
- **Entry:** recognizing that double-booking is *the* problem and proposing *any* reservation-
  with-expiry that avoids long-held locks is a solid answer. The atomicity race and the on-sale
  spike are bonus; don't penalize their absence.
- **Mid:** expected to design the booking flow end to end (status + expiry), separate the
  availability-first read path from the consistency-first write path *unprompted*, and keep
  search off `LIKE` scans. Should engage with the reservation race when pushed.
- **Senior:** expected to *drive* the hard parts — prove the reserve step is atomic, handle the
  high-demand queue, reason about what happens when the lock store fails (does the DB still
  prevent a double sale?), and weigh consistency vs. availability per subsystem. A design that
  only reaches "Good," or that leaves the seat race unresolved, is **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- A cron/sweeper that resets expired reservations (simple, but there's lag between expiry and
  release) vs. an *implicit* expiry checked at reserve time (no lag, slightly more complex
  reads).
- A distributed TTL lock (auto-releases, fast, decouples from the DB) vs. a DB-only conditional
  update (one fewer moving part, but hotter on the primary) — and the insight that even if the
  lock store dies, the DB transaction must still be the thing that prevents a double sale.
- Prioritizing availability for browse/search (cache + replicas, tolerate staleness) vs.
  consistency for booking (transactional, no stale reads) — the same system making opposite
  CAP choices per path.
- A virtual waiting queue smooths load and gives users a fair, legible wait, at the cost of
  added infrastructure and the UX risk of long queues (mitigated by showing position/ETA).
