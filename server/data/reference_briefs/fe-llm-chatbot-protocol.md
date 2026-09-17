# Reference brief — fe-llm-chatbot-protocol: "What protocol would you use to integrate an LLM-powered chatbot into a frontend application, and why?"

## What this question is really testing
Does the candidate recognize that **LLM responses arrive token by token, so you want
streaming** — not a single request that hangs for ten seconds and then dumps a wall of text —
and can they pick the right transport for the traffic shape and justify it against the
alternatives? Grade the streaming insight and the SSE-vs-WebSockets tradeoff.

## Concept anchors (demonstrated capability, not keywords)
- **The core observation** — tokens stream, so the UX must stream; don't make the user wait for
  the whole response.
- **SSE is the default right answer for chat** — LLM output flows one way (server → client),
  which is exactly what Server-Sent Events are for: runs over ordinary HTTP, auto-reconnects, and
  is what most LLM streaming APIs already speak, so it's simple to wire up.
- **When to reach for WebSockets** — genuine full-duplex, low-latency needs: live voice,
  collaborative editing, interrupting mid-generation with two-way signaling. More powerful, more
  operational overhead — over-engineering for a plain text chatbot.
- **A third valid option** — plain HTTP streaming via `fetch` + a `ReadableStream`.
- **The anti-pattern** — never poll on an interval for something meant to feel real-time;
  wasteful and laggy.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** a single request/response that waits for the full answer, or interval polling —
  no streaming insight.
- **Good (3–4):** recognizes streaming is needed and picks SSE (or HTTP streaming) for the
  one-way server→client flow, with a basic justification.
- **Great (5):** all of Good, **plus** the SSE-vs-WebSockets tradeoff — SSE for one-directional
  streaming, WebSockets only when you truly need two-way (voice, interruption, collaboration),
  never polling — and knowing WebSockets are over-engineering for plain chat.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** knowing the response should stream rather than arrive all at once, and naming SSE or
  HTTP streaming, is a solid answer. The full transport tradeoff is bonus.
- **Mid:** expected to choose SSE for the one-way flow *unprompted* and justify it against a plain
  request and against polling — this is the level this question is aimed at.
- **Senior:** expected to lay out the whole tradeoff crisply (SSE default, WebSockets only for
  true bidirectional low-latency, HTTP streaming as an option, never polling) and call WebSockets
  over-engineering for text chat.

## Tradeoffs worth crediting when the candidate raises them
- SSE (one-way, over HTTP, auto-reconnect, what LLM APIs speak — simple) vs. WebSockets
  (full-duplex, low-latency, but more operational overhead — justified only for voice/
  collaboration/interruption).
- HTTP streaming with `fetch`/`ReadableStream` (works, flexible) as a middle option.
- Streaming (tokens appear as generated, responsive UX) vs. one big response (simple, but a long
  hang then a wall of text) vs. polling (never — wasteful and laggy for real-time feel).
