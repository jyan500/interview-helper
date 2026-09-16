# Frontend / TypeScript conventions

Coding conventions for the client SPA (`client/`, Vite + React + TypeScript). See `CLAUDE.md` for the
project overview and architecture; this file is the detail for frontend work.

- **4-space indentation** in client/TS code (not the 2-space default).
- **Config in `.env` → one constants module.** API URLs etc. go through `src/constants.ts`, never
  inline literals; env vars are `VITE_*` (`VITE_API_BASE_URL`, `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`).
- **Route client HTTP through an RTK Query hook** — a new backend call gets an endpoint + hook (even
  imperative ones, via a wrapper hook), never a raw `fetch` (auth headers come free from `api.ts`).
- **Inject the data-source trigger, not a closure** — reusable components take the endpoint trigger;
  fetch/paginate orchestration stays inside.
- **One flow flag** for async UI pipelines (set at flow-start, cleared at flow-end) — don't OR loading
  booleans together and patch the gaps.
- **Route access checks go in a React Router layout route** (like `ProtectedRoute`), not an inline
  `<Navigate>` in the page.
- **Extract:** pure functions → `helpers.ts`, custom hooks → `hooks.ts`; subcomponents get their own
  files; reusable shells (e.g. `Modal`) take `children`, not bespoke per-use copies. Two types sharing
  fields but differing in one → a shared base interface they extend.
- **`Modal` shell** takes children; modals close via X / Esc only, never a backdrop click.
- **Access `localStorage` directly** — no speculative try/catch wrapping.
- **Dropdowns:** plain non-API dropdowns use react-select's `Select` (installed); API-backed ones use
  the async-paginate variant.
- **Icons:** UI indicators (sort arrows, carets, etc.) use `@phosphor-icons/react`, not ASCII/unicode
  glyphs.
- **Dates:** `formatShortDate` (mm/dd/yyyy); message-row/turn times via `formatTime` (h:mm). No other
  bespoke date formatters.
- **Toasts:** use `useToast` (`src/toast`) for transient success/error, not ad-hoc `setTimeout`.
- **Loading skeletons** match component shape — populated components take a `loading` prop and a
  skeleton built on the shared `Skeleton` primitive.
- **A shared class-string constant holds only reusable classes** — height/width go per-component.
- **Filters apply on submit** — scope/filter controls are an RHF form applied by a submit button, never
  auto-applied on change.
- **Interview length is dynamic** (follow-ups vary) — no fixed count, no "question N of M" UI.
- **Candidate speaking indicator** = pulsing mic icon via `hark` loudness. (Silero-VAD consolidation
  was tried and rolled back for ~1–2s onset latency.)
- **`npm install` from inside `client/`** — never `--prefix` (dumps bin shims into the folder root on
  Windows).
