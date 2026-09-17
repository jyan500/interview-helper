# Reference brief — fe-scale-frontend: "How would you scale a frontend application from 1,000 to 100,000 daily users?"

## What this question is really testing
Does the candidate know that **scaling a frontend is about delivery, caching, and resilience —
not the application code**? The reframe is the whole answer: a hundred thousand users hit the
same static bundle; the bundle doesn't care, but the network and the APIs do. Grade whether they
resist the trap of "optimize my React components."

## Concept anchors (demonstrated capability, not keywords)
- **The reframe** — "scaling" on the frontend means CDN, caching, performance, and monitoring;
  horizontal scaling is a backend concern.
- **Delivery** — static assets behind a **CDN with edge caching**, served close to users.
- **Ship less** — code splitting, tree shaking, lazy loading so first load stays fast.
- **Caching strategy** — HTTP cache headers, a data-fetching layer (React Query / SWR), service
  workers where they help.
- **Protect the backend** — request batching, pagination, client caching, because at scale the
  **API is usually the real bottleneck**, not the JS.
- **Rendering strategy** — SSR / static generation / edge rendering for TTFB and SEO.
- **Observability** — real-user monitoring, error tracking (e.g. Sentry), performance budgets, so
  you catch degradation before users report it.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** proposes optimizing React components / adding servers to the frontend — misses
  that the static bundle is served identically regardless of user count.
- **Good (3–4):** CDN for assets, bundle splitting/lazy loading, a caching layer, and awareness
  that the API is the likely bottleneck.
- **Great (5):** all of Good, **plus** the explicit reframe (delivery/caching/resilience, not app
  code), a rendering-strategy choice tied to TTFB/SEO, backend-protection tactics (batching,
  pagination), and observability (RUM, error tracking, perf budgets).

## Leveling bands — the SAME answer clears a different bar
- **Entry:** CDN + smaller/split bundles + some caching is a reasonable answer — but this is a
  senior-tagged question, so that's the floor.
- **Mid:** expected to cover delivery, caching, and that the API (not the JS) is usually the
  bottleneck.
- **Senior:** expected to lead with the reframe, move through the layers (CDN → ship less →
  caching → backend protection → rendering strategy → observability), and land the one-liner that
  frontend "scaling" is CDN/caching/performance/monitoring. Optimizing components is **below bar**.

## Tradeoffs worth crediting when the candidate raises them
- CDN/edge caching (serves the same bundle cheaply to everyone) vs. treating the frontend like a
  stateful backend (wrong mental model at this scale).
- SSR / static generation / edge rendering (better TTFB and SEO) vs. pure client rendering
  (simpler, slower first paint) — chosen per app needs.
- Client caching + batching + pagination (offloads the API, the real bottleneck) at the cost of
  data-freshness and cache-invalidation complexity.
- Observability up front (catch regressions early) vs. flying blind (users report degradation
  first).
