# Reference brief — sd-fb-live-comments: "How would you design a real-time live-comments system for a live video like Facebook Live?"

## What this question is really testing
Can the candidate **broadcast a high-velocity comment stream to a large, read-heavy audience in
near real time**, route comments efficiently to only the servers whose viewers are watching a
given video, and cope when a single stream has millions of concurrent viewers? The problem is
fan-out of a write-light-per-user but read-heavy workload, plus connection management. Grade the
*reasoning about push transport and about not doing wasted work at fan-out*, not vocabulary.

## Concept anchors (demonstrated capability, not keywords)
- **A push transport suited to a read-heavy, one-way flow.** Viewers mostly *receive*; the
  natural fit is **server-sent events (SSE)** (one-way, over HTTP, lighter than websockets) or
  websockets — and recognizing that **polling** wastes load because usually there's nothing new
  is the baseline insight.
- **Routing comments only to servers that need them.** A naive "every realtime server subscribes
  to every video" burns compute at scale. Credible answers **co-locate viewers of the same video**
  (consistent hashing on video id) and/or use a **dispatcher** that maps which servers hold which
  videos and routes comments there.
- **Coping with mega-streams** (millions of viewers): options like **sampling** the comment
  firehose (humans can't read 5k/sec anyway) or **snapshotting recent comments to a CDN** that
  clients poll, trading a second of latency for a massive drop in per-connection cost.
- **Cursor pagination** for historical comments (not offset), and reconnect handling (replay
  missed comments from a last-seen id, bounded).

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** clients poll every few ms for new comments; every server processes every
  comment for every video; offset pagination for history; a reconnect starts fresh and loses
  context.
- **Good (3–4):** a persistent push transport (SSE/websockets), a pub/sub layer partitioned so
  viewers of the same video land on the same server, and cursor pagination for history. May not
  address the mega-stream case or the wasted-work problem precisely.
- **Great (5):** all of Good, **plus** an explicit answer to fan-out efficiency (a dispatcher or
  consistent-hashing routing so servers only handle videos they have viewers for), a
  **mega-stream strategy** (sampling and/or CDN snapshots + client polling with local optimistic
  insert for read-your-own-write), and **reconnect replay** via a last-event-id with dedup.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** choosing a push transport over polling and having a coherent fan-out via pub/sub is
  a strong answer. The dispatcher, mega-stream handling, and reconnect replay are bonus; don't
  penalize their absence.
- **Mid:** expected to reject polling *unprompted*, pick SSE/websockets with a reason, and design
  the pub/sub fan-out. Should recognize the "every server sees every comment" waste when pushed.
- **Senior:** expected to *drive* the scaling — efficient routing (dispatcher / co-location), the
  millions-of-viewers case (sampling or CDN snapshots), reconnect/replay, and the SSE-vs-websocket
  tradeoff for a read-heavy load. A design that only reaches "Good," or has no answer for a viral
  stream, is **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- SSE (one-way, HTTP-friendly, lighter — matches a read-heavy audience) vs. websockets
  (bidirectional, more overhead when clients rarely send) vs. polling (simplest, but wasteful
  and higher latency).
- Naive pub/sub where every server subscribes to everything (simple, but O(all comments) work
  per server) vs. co-locating viewers by video + a dispatcher (only relevant servers get a
  comment, at the cost of coordination to keep the mapping fresh during viral spikes).
- For mega-streams: sampling comments (cheaper, viewers can't read them all anyway) and/or CDN
  snapshots polled by clients (drops per-connection cost hugely) at the cost of ~1–2s added
  latency and needing local optimistic insertion so users see their own comment immediately.
- Cursor pagination (stable, index-friendly) vs. offset (counts preceding rows, unstable as
  comments arrive).
