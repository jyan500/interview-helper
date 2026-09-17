# Reference brief — fe-event-loop: "Give a high-level overview of the JavaScript event loop."

## What this question is really testing
Whether the candidate's mental model of asynchronous JavaScript is **correct or superstitious** —
specifically whether they know the **microtask-before-macrotask** ordering, not just "JS is
async." Grade for the priority rule and a concrete proof.

## Concept anchors (demonstrated capability, not keywords)
- **Single thread, one call stack** — JS does one thing at a time; synchronous code runs on the
  stack.
- **Async work is handed off** — timers, network, DOM events go to the browser's Web APIs while
  code keeps running; when they finish, their callback is queued.
- **The priority rule (the whole point):** when the stack is empty, the loop **drains the entire
  microtask queue** (Promise callbacks, `queueMicrotask`), then takes **one macrotask**
  (`setTimeout` callback, an event), then lets the browser render, then repeats. Microtasks always
  have priority.
- **The concrete proof** — `Promise.resolve().then(...)` runs before `setTimeout(..., 0)` despite
  the zero delay — and that a long synchronous loop blocks everything including rendering, which
  is why heavy work belongs in a **web worker**.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** "JavaScript is asynchronous / non-blocking" with no model of the stack, queues,
  or ordering; thinks `setTimeout(0)` runs immediately.
- **Good (3–4):** single thread + call stack, async handed to Web APIs and queued, loop runs
  queued callbacks when the stack is empty. May blur microtasks vs macrotasks.
- **Great (5):** all of Good, **plus** the microtask-drains-fully-then-one-macrotask-then-render
  ordering, the Promise-before-setTimeout(0) proof, and that a long sync task blocks rendering →
  offload to a web worker.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** single-threaded, offloads async to the browser, runs callbacks when free — a solid
  answer. The microtask/macrotask ordering is bonus; don't penalize its absence.
- **Mid:** expected to distinguish the microtask and macrotask queues and their priority
  *unprompted*.
- **Senior:** expected to give the precise ordering, prove it with Promise-vs-setTimeout, and
  connect blocking to rendering and web workers. A vague "it's async" answer is **below bar** for
  senior.

## Tradeoffs worth crediting when the candidate raises them
- Microtasks (drained fully, high priority — great for chaining, but a microtask that keeps
  scheduling microtasks can starve rendering) vs. macrotasks (one per loop turn, lets rendering
  happen between them).
- Doing heavy work on the main thread (simple, but freezes UI/rendering) vs. a web worker (keeps
  the UI responsive, at the cost of message-passing complexity).
