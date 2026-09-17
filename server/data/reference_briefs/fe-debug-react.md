# Reference brief — fe-debug-react: "How would you debug a slow React app?"

## What this question is really testing
Does the candidate **measure before fixing** — reaching for profiling tools to find the real
bottleneck rather than reciting a list of guesses — and can they separate the two kinds of
"slow"? Grade the methodology first, the fixes second.

## Concept anchors (demonstrated capability, not keywords)
- **Measure first.** Use the React DevTools Profiler ("why did this render"), the Chrome
  Performance panel (flame graph), and Lighthouse (load-time) to locate the bottleneck before
  touching code.
- **The usual suspects, once measured** — unnecessary re-renders; long lists rendered all at once
  (fix with virtualization, e.g. `react-window`); expensive recalculations (`useMemo`); unstable
  function/object prop references (`useCallback` + `React.memo`); oversized bundles (code
  splitting, lazy loading).
- **Two kinds of slow** — *load* performance (how fast the app appears) vs. *runtime* performance
  (how smoothly it responds once loaded) have different causes and fixes.
- **The senior caution, volunteered** — don't scatter `useMemo`/`useCallback` preemptively;
  premature memoization adds complexity and can be slower. Measure, then optimize what's
  measurably slow.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** a list of guesses / "add `useMemo` everywhere" with no measurement step.
- **Good (3–4):** starts with profiling tools, then targets the measured bottleneck with the
  right fix (virtualization, memoization, code splitting).
- **Great (5):** all of Good, **plus** separating load vs runtime performance and volunteering the
  caution against premature memoization — measure, then optimize the measured problem.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** "profile it first, then fix what the profiler points to" plus a couple of concrete
  fixes is a solid answer. The load/runtime split is bonus; don't penalize its absence.
- **Mid:** expected to lead with measurement *unprompted* and name the right fix for each common
  cause.
- **Senior:** expected to separate load vs runtime performance and warn against premature
  memoization without being asked. A guess-list with no measurement is **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- Measure-then-fix (targets the real bottleneck) vs. guess-and-optimize (wastes effort, may not
  move the needle).
- `useMemo`/`useCallback`/`React.memo` (cut re-renders when there's a measured problem) vs.
  applying them everywhere (complexity and sometimes *slower* — premature memoization).
- Virtualization for long lists (renders only what's visible) vs. rendering everything (simple,
  but janky at scale).
- Load fixes (code splitting, lazy loading, bundle size) vs. runtime fixes (re-render reduction) —
  different problems, different tools.
