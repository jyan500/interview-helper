# Reference brief — sd-whatsapp: "How would you design a real-time chat system like WhatsApp?"

## What this question is really testing
Can the candidate design around the defining constraint of real-time chat — messages must be
**pushed** to recipients in near real time, but recipients are frequently **offline** and
spread across **many stateful servers holding live connections**? The hard problems are
therefore *routing a message to whichever server holds the recipient's connection*,
*delivering reliably to someone who is offline right now*, and *never losing a message*. Grade
the *reasoning about delivery guarantees and connection state*, not the vocabulary.

## Concept anchors (demonstrated capability, not keywords)
- **A persistent connection model** — long-lived websockets rather than polling — and the
  recognition that this makes the chat servers **stateful** (each holds a set of live
  connections), which is what makes routing hard.
- **How a message reaches the right recipient's server.** A naive load balancer in front of
  interchangeable servers *breaks*, because the sender's server isn't the one holding the
  recipient's socket. Credible answers route by user (consistent hashing to a home server, or a
  **pub/sub layer** where each server subscribes to the users it holds and forwards to the
  socket).
- **Durability before delivery.** The message must be **persisted (to a per-recipient inbox)
  before** any best-effort real-time push, so an offline recipient — or a dropped push — still
  gets it on reconnect. Naming that ordering (write, then notify) is the key insight.
- **Offline delivery + catch-up** — an inbox/mailbox the client drains on reconnect, and some
  way to detect gaps (acks, sequence numbers) so a missed push is noticed.
- **Detecting dead connections** — application-level heartbeats/pings, because TCP timeouts are
  far too slow to notice a silently dropped client.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** clients poll a database for new messages; or "just put the chat servers behind
  a load balancer" with no answer for how a message finds the recipient's connection; no story
  for offline users; messages can be lost if a server or push fails.
- **Good (3–4):** websockets for real-time delivery, a routing scheme so a message reaches the
  server holding the recipient (consistent hashing or pub/sub), and a durable inbox that
  offline users drain on reconnect. May be fuzzy on the persist-before-push ordering or on
  detecting missed messages.
- **Great (5):** all of Good, **plus** the explicit **write-to-inbox-then-best-effort-push**
  ordering that guarantees eventual delivery, **application heartbeats** to detect dead
  connections quickly, **sequence numbers / acks** so clients detect and fill gaps, and
  handling of **multiple devices per user** and group-message fan-out — with a clear stated
  delivery guarantee (e.g. at-least-once + client dedupe).

## Leveling bands — the SAME answer clears a different bar
- **Entry:** choosing websockets over polling and having *any* coherent answer for storing a
  message so an offline user gets it later is a strong answer. Cross-server routing and gap
  detection are bonus; don't penalize their absence.
- **Mid:** expected to confront the stateful-server routing problem *unprompted* (pub/sub or
  consistent hashing), design the durable inbox + reconnect flow, and reason about at-least-once
  vs. at-most-once delivery when pushed.
- **Senior:** expected to *drive* the reliability story — persist-before-push, heartbeats,
  sequence-number gap detection, multi-device, group fan-out — and reason about what breaks when
  a chat server dies mid-delivery. A design that only reaches "Good," or where a failed push
  silently loses a message, is **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- Websockets/persistent connections (true real-time push, but stateful servers and connection
  management) vs. polling (stateless and simple, but latency and load that don't scale).
- Consistent hashing to a home server (direct routing, but rebalancing churn on scale events)
  vs. a pub/sub layer (elastic, decoupled, but adds a hop and is typically at-most-once — hence
  the durable inbox behind it).
- Persist-then-push (never lose a message; the DB write is on the hot path) — the ordering that
  makes best-effort real-time delivery safe.
- Server-timestamp ordering (simple, occasionally a message pops in slightly out of order,
  which users tolerate) vs. strict ordering buffers (correct order at the cost of added
  latency).
- Heartbeat frequency: faster pings detect dead connections sooner but cost real
  request volume at billions of connections.
