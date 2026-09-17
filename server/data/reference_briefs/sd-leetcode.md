# Reference brief — sd-leetcode: "How would you design an online coding-judge platform like LeetCode?"

## What this question is really testing
Can the candidate recognize that the defining risk is **running untrusted user code safely**,
and design around **isolation**, **executing at scale within a latency budget**, and a
**live contest leaderboard**? The centerpiece is the security/isolation of arbitrary submitted
code — a candidate who treats "run the code" as a trivial step is missing the whole point.
Grade the *reasoning about isolation and about scaling a bursty, CPU-bound workload*, not
vocabulary.

## Concept anchors (demonstrated capability, not keywords)
- **Never run submissions on the API server.** Untrusted code must run in an **isolated
  sandbox** — a container (or VM/serverless) with a **read-only filesystem, CPU/memory limits,
  a hard timeout, and no network** — so a malicious or runaway submission can't harm the
  platform. Naming the *hardening*, not just "use Docker," is the capability.
- **Executing at scale asynchronously.** A burst of submissions (a contest) is CPU-bound and
  spiky; the answer is **horizontally scaled worker pools fed by a queue**, with the client
  polling for the result — decoupling submission from execution and enabling retries.
- **A real-time-ish leaderboard.** A **Redis sorted set** updated on each accepted submission
  serves near-real-time rankings; short-interval polling is a reasonable, simpler alternative to
  websockets. Recognizing that DB-polling-for-top-N per client melts the DB is the insight.
- **A language-agnostic test harness** — a standardized (serialized) test format and per-
  language harness — so problems don't need N hand-written suites.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** execute submitted code directly on the app server; scale by making that one
  machine bigger; build the leaderboard by having every client poll the DB for the top N and
  sort on each request. Security and scale are both unaddressed.
- **Good (3–4):** run code in an isolated environment (container or VM), execute via a worker
  pool, and cache the leaderboard in Redis refreshed periodically. May under-specify the sandbox
  hardening or the async submit-then-poll flow.
- **Great (5):** all of Good, **plus** concrete **sandbox hardening** (read-only FS, resource
  caps, timeouts, no network, syscall restrictions), an **async queue + autoscaled workers**
  design justified with rough capacity math (why one machine can't do 10k submissions × many
  test cases in seconds), a **Redis sorted set** leaderboard with a sensible poll interval, and
  a language-agnostic harness.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** recognizing that untrusted code must run in *some* isolated sandbox off the API
  server, plus a basic execution and leaderboard design, is a strong answer. Hardening specifics
  and queue-based autoscaling are bonus; don't penalize their absence.
- **Mid:** expected to reach for containers/VMs *unprompted*, weigh their isolation-vs-overhead
  tradeoff, and design the execution path and a cached leaderboard. Should engage with the burst
  scaling and sandbox hardening when pushed.
- **Senior:** expected to *drive* the depth — full sandbox hardening, an async queue with
  autoscaled workers backed by capacity reasoning, a sorted-set leaderboard, and the test
  harness. A design that runs code without real isolation, or only reaches "Good," is
  **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- VMs (strongest isolation, but heavy and slow to start) vs. containers (lightweight, fast, but
  share the kernel so need careful hardening) vs. serverless functions (auto-scaling, but
  cold-start latency and resource limits).
- Synchronous execution (simple, but ties up a request and can't absorb spikes) vs. a queue +
  worker pool with polling for results (absorbs bursts, enables retries and fault tolerance, at
  the cost of added complexity and eventual results).
- A Redis sorted set with short-interval polling (near-real-time, simpler than websockets, small
  delay) vs. websockets (true push, but connection overhead) vs. DB polling (simple, but melts
  the DB under contest load).
- Over-engineering risk: a full async pipeline may exceed what the expected volume needs — worth
  naming the safety-vs-simplicity call.
