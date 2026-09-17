# Reference brief — sd-uber: "How would you design a ride-hailing service like Uber?"

## What this question is really testing
Can the candidate handle a **firehose of driver location updates** and **proximity search** over
them, **match a rider to a nearby driver without ever assigning one driver to two riders**
(strong consistency on matching), and stay up under **peak-demand spikes** — all with a
sub-minute matching latency? The pillars are geospatial location handling, match consistency,
and load/failure resilience. Grade the *reasoning about geospatial scale and about the matching
race*, not vocabulary.

## Concept anchors (demonstrated capability, not keywords)
- **Location updates don't belong in a plain OLTP table.** Millions of updates/sec plus
  proximity queries call for an **in-memory geospatial store** (geohashing / geo commands, e.g.
  Redis) with TTL to expire stale positions — recognizing that B-tree indexes are wrong for
  multi-dimensional proximity, and that writing every ping to a durable DB is ruinously
  expensive, is the insight.
- **Match consistency.** Matching must **lock a candidate driver so two riders can't both get
  them** — best done with a **distributed lock with a TTL** (auto-releases if the driver doesn't
  respond, survives a matching-service crash), not an in-process lock or a naive status flag
  whose timeout is lost on restart.
- **Absorbing demand + retries.** Ride requests go through a **durable queue** (so nothing is
  dropped and a crashed worker's request is re-picked), with a **delay/retry** to move on to the
  next driver when one doesn't respond — or a **durable workflow** engine to own the timeout/
  retry/fallback logic.
- **Adaptive client behavior** — varying location ping frequency by speed/state to cut load — and
  **geo-sharding** for scale.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** write every driver ping to a relational table and scan it for proximity; match
  with an in-process lock or a status flag with no durable timeout; first-come-first-served with
  no queue, so spikes drop requests and a crash loses in-flight rides.
- **Good (3–4):** a geospatial store/index for proximity, batched location writes, a match path
  that reserves a driver with a DB status + timeout, and awareness that peak load needs queuing.
  May leave the lock's crash-recovery or the retry coordination loose.
- **Great (5):** all of Good, **plus** an **in-memory geo store with TTL** for real-time
  proximity, a **distributed TTL lock** that provably prevents double-assignment and survives a
  service crash, a **durable queue (offset committed only after a match)** with autoscaling and
  a **delay-queue or durable-workflow** retry to the next driver, plus adaptive client ping rates
  and geo-sharding with read replicas.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** a proximity search over driver locations and a matching flow that avoids obvious
  double-assignment is a strong answer. The in-memory geo store, distributed lock, and queueing
  are bonus; don't penalize their absence.
- **Mid:** expected to reach for a geospatial index *unprompted*, design the match path, and
  recognize that peak demand needs a queue. Should engage with the double-assignment race and
  the lock's failure modes when pushed.
- **Senior:** expected to *drive* two or more deep dives — real-time geo store with TTL, a
  crash-safe distributed lock, a durable queue with retry/fallback (delay queue or workflow
  engine), and geo-sharding — reasoning about what happens when Redis or a matching worker dies.
  A design where a driver can be double-assigned, or that only reaches "Good," is **below bar**
  for senior.

## Tradeoffs worth crediting when the candidate raises them
- In-memory geo store with TTL (real-time, high throughput; durability risk mitigated by short
  update intervals + failover) vs. batched writes to a geospatial DB (durable, cheaper writes,
  but locations lag reality → worse matches) vs. per-ping OLTP writes (accurate, ruinous cost).
- Distributed TTL lock (auto-expires, survives crashes) vs. DB status + in-memory timeout (simple,
  but the timeout is lost if the service restarts → stuck lock) vs. app-level lock (no cross-
  instance coordination → race conditions).
- Durable queue for requests (no drops, redistributes a crashed worker's load, autoscales) at the
  cost of queue complexity and head-of-line blocking (mitigated by a proximity/rating priority
  queue).
- Delay queue for retrying the next driver (simple) vs. a durable-execution workflow (fault-
  tolerant, resumable, cleaner logic, but a new tool/component to learn and monitor).
- Adaptive client ping frequency (less server load, keeps accuracy) at the cost of on-device
  complexity; geo-sharding (locality, scale) at the cost of scatter-gather on boundary queries.
