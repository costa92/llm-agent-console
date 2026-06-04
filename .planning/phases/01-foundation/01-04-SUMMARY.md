---
phase: 01-foundation
plan: 04
subsystem: ui
tags: [react19, tanstack-router, tanstack-query, shadcn, sonner, react-hook-form, operator-context, shell]

# Dependency graph
requires:
  - phase: 01-02
    provides: "web/ SPA scaffold (Vite + React 19 + TS 5.9.3 + Tailwind v4 + 12 shadcn components + Vitest + placeholder root route + QueryClient)"
  - phase: 01-03
    provides: "BFF GET /api/config/env (env name + base URLs, no secrets) consumed by the TopBar env indicator"
provides:
  - "OperatorContextProvider: React context + localStorage persistence of non-secret scope (tenant/user/project/session); useOperatorContext hook"
  - "makeApiFetcher: shared REST fetch wrapper injecting X-Console-Tenant/User/Project/Session; never sets an auth/bearer header (D-01)"
  - "openSseStream: typed @microsoft/fetch-event-source wrapper stub (POST-based; unused in Phase 1, inherited by Phase 3/4)"
  - "App shell: NavBar (Memory/Flow/Chat, active = blue accent) + TopBar (env indicator + 3 unknown health dots) + OperatorContextBar (amber-when-unset, popover edit) + Shell layout"
  - "TanStack Router tree: root Shell + /memory /flow /chat placeholders + / -> /memory redirect; routeTree shared by main.tsx and tests"
  - "SHELL-06 reportError helper: '{action} failed — {status}: {message}' + Copy error affordance; sonner Toaster mounted app-wide"
affects: [phase-01-05-primitives, phase-02-memory, phase-03-flow, phase-04-chat, phase-05-health-polling]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Provider+hook co-location (OperatorContextProvider) with localStorage-backed useState initializer"
    - "Shared fetch wrapper (makeApiFetcher) as the single X-Console-* injection point — bar component only calls setContext, never touches headers/storage"
    - "TanStack Router: rootRoute (Shell) + createRoute children assembled into a shared routeTree module; tests use createMemoryHistory + createRouter + RouterProvider (no MemoryRouter export exists)"
    - "react-hook-form popover edit form; CTA label flips Set context (unset) / Save context (both set) per UI-SPEC"
    - "sonner toast.error with a { action: { label: 'Copy error' } } custom action as the SHELL-06 error-toast contract"
    - "jsdom window.scrollTo stub in test setup so router scroll-restoration stays quiet under jsdom"

key-files:
  created:
    - web/src/app/OperatorContextProvider.tsx
    - web/src/lib/api.ts
    - web/src/lib/sse.ts
    - web/src/app/Shell.tsx
    - web/src/app/router.tsx
    - web/src/app/routes/__root.tsx
    - web/src/app/routes/memory.tsx
    - web/src/app/routes/flow.tsx
    - web/src/app/routes/chat.tsx
    - web/src/components/shell/NavBar.tsx
    - web/src/components/shell/TopBar.tsx
    - web/src/components/shell/OperatorContextBar.tsx
    - web/src/components/shell/HealthDot.tsx
    - web/src/test/OperatorContext.test.tsx
    - web/src/test/NavBar.test.tsx
    - web/src/test/Toast.test.tsx
  modified:
    - web/src/main.tsx
    - web/src/test/setup.ts
    - web/eslint.config.js

key-decisions:
  - "Added a shared web/src/app/router.tsx exporting the assembled routeTree (plus a / -> /memory redirect) so main.tsx and the NavBar test consume the same tree — the plan listed __root/memory/flow/chat but the tree needs one assembly point; router.tsx is that point, no new scope"
  - "reportError SHELL-06 helper lives in OperatorContextBar.tsx (plan scope + acceptance grep require 'Copy error' there); co-export accepted via a single inline eslint-disable rather than relocating"
  - "Index route redirects to /memory so the shell always lands on a console rather than a blank root"
  - "Toast.test uses @testing-library/react render + fireEvent-free assertions; did NOT add @testing-library/user-event (not installed; package-install is out of auto-fix scope) — the SHELL-06 cases only assert presence/absence of 'Copy error', no click needed"

patterns-established:
  - "All later REST fetchers route through makeApiFetcher(ctx) for X-Console-* injection"
  - "Phase 3/4 SSE inherits openSseStream from web/src/lib/sse.ts"
  - "Route modules export a route object alongside their page component (ESLint react-refresh rule disabled for src/app/routes/**)"

requirements-completed: [SHELL-01, SHELL-03, SHELL-04, SHELL-06]

# Metrics
duration: 6min
completed: 2026-06-03
---

# Phase 1 Plan 04: Shell Layout Summary

**The operator-visible SPA shell — NavBar (Memory/Flow/Chat with blue active accent) + TopBar (monospace env indicator from /api/config/env + three unknown health dots) + OperatorContextBar (amber-when-unset, popover edit, localStorage-persisted non-secret scope) — wired into a TanStack Router tree with placeholder routes, the makeApiFetcher X-Console-* header-injection wrapper, the openSseStream Phase-3 stub, and the SHELL-06 error-toast contract.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-03T07:05:57Z
- **Completed:** 2026-06-03T07:11:39Z
- **Tasks:** 2 of 2
- **Files:** 19 (16 created, 3 modified) under web/ (node_modules NOT committed)

## Accomplishments

- **OperatorContextProvider** initializes from `localStorage('operator-context')` (try/catch fallback to empty), persists `{tenantId,userId,projectId,sessionId}` on every update — and ONLY those (D-01: operator auth token never stored). `useOperatorContext` throws outside the provider.
- **makeApiFetcher(ctx)** injects `X-Console-Tenant/User/Project/Session` only when non-empty; never sets an Authorization/bearer header (the wrapper grep for `Authorization` is 0).
- **sse.ts** exports `openSseStream` over `@microsoft/fetch-event-source` (POST default), documented as a Phase-3/4 stub with zero call sites in Phase 1.
- **Shell** renders NavBar + TopBar + an Outlet main region. **NavBar** uses TanStack Router `Link` + `activeProps` so the active console gets the blue accent (`nav-active` + `var(--primary)`). **TopBar** reads `/api/config/env` via `useQuery`, shows env + memory_base in mono (muted "Loading…" / red "env unavailable" states), plus three `HealthDot`s all in `unknown` slate state with service labels.
- **OperatorContextBar** shows TENANT/USER (and PROJECT/SESSION when set) as mono values; amber border + tint + "not set" copy when tenant or user is empty; click-to-popover react-hook-form edit with the Set/Save context CTA; success `toast.success('Context saved.')`. The bar never touches headers or localStorage (those are api.ts / provider responsibilities — verified by grep = 0).
- **SHELL-06**: `reportError(action,status,message)` emits `toast.error('{action} failed — {status}: {message}', { action: { label: 'Copy error', onClick: clipboard.writeText } })`. `Toaster` mounted app-wide in main.tsx.
- **Routes**: `/memory /flow /chat` placeholders render "{X} console — arrives in Phase {N}." in muted body text; `/` redirects to `/memory`.
- All gates green: 13 Vitest tests pass, `tsc --noEmit` exit 0, `npm run build` emits dist, `npm run lint` 0 errors (2 pre-existing shadcn warnings).

## Task Commits

1. **Task 1: OperatorContextProvider + api.ts header injection + sse.ts stub** — `821536a` (feat, TDD: 6 behavior cases written first, then implementation)
2. **Task 2: Shell layout — NavBar + TopBar + OperatorContextBar + HealthDot + routes + Toast.test** — `1557120` (feat, TDD: NavBar/OperatorContextBar/Toast behavior cases)

_TDD note: per the established 01-03 convention, each task's RED and GREEN landed in one atomic feat commit rather than separate test/feat commits._

## Files Created/Modified

See `key-files` frontmatter. Headline: 13 new shell/app/lib/test files, plus `main.tsx` (route tree + provider + Toaster wiring replacing the placeholder root), `test/setup.ts` (scrollTo stub), and `eslint.config.js` (routes-module react-refresh override).

## Decisions Made

See `key-decisions` frontmatter. Headline: a shared `router.tsx` assembles the routeTree consumed by both `main.tsx` and the NavBar test; the SHELL-06 `reportError` helper is co-located in `OperatorContextBar.tsx` per plan scope + acceptance grep; `/` redirects to `/memory`; `@testing-library/user-event` was NOT installed (out of auto-fix scope) — the SHELL-06 toast tests only assert presence/absence of "Copy error", which needs no click.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `npm run build` (tsc -b, app config) flagged an unused `@ts-expect-error` in NavBar.test.tsx**
- **Found during:** Task 2 (build gate)
- **Issue:** The test wrapped `<RouterProvider router={router} />` with `@ts-expect-error` (the test router instance differs from the registered app router type). Under the app `tsc -b` config the types actually align, so the directive was unused → TS2578.
- **Fix:** Removed the directive; the types check clean without it.
- **Files modified:** web/src/test/NavBar.test.tsx
- **Verification:** `npm run build` succeeds; `tsc --noEmit` exit 0.
- **Committed in:** `1557120`

**2. [Rule 3 - Blocking] ESLint `react-refresh/only-export-components` errored on route modules, the provider's hook, and the reportError helper**
- **Found during:** Task 2 (lint gate)
- **Issue:** TanStack Router route files export a route object beside their page component; `OperatorContextProvider.tsx` co-exports the canonical `useOperatorContext` hook; `OperatorContextBar.tsx` co-exports the SHELL-06 `reportError` helper. The fast-refresh rule fires on all three — none are refactorable without fighting the framework/plan scope.
- **Fix:** Added a flat-config override turning the rule off for `src/app/routes/**` (route objects aren't fast-refreshable components); single inline `eslint-disable-next-line` on the `useOperatorContext` export (provider+hook co-location is idiomatic) and on the `reportError` export (the SHELL-06 helper must live in the bar file per the acceptance grep).
- **Files modified:** web/eslint.config.js, web/src/app/OperatorContextProvider.tsx, web/src/components/shell/OperatorContextBar.tsx
- **Verification:** `npm run lint` exits 0 (2 pre-existing shadcn warnings on badge.tsx/button.tsx, unchanged from 01-02).
- **Committed in:** `1557120`

**3. [Rule 3 - Blocking] jsdom `window.scrollTo` not implemented under TanStack Router scroll restoration**
- **Found during:** Task 2 (NavBar test run)
- **Issue:** Router navigation in tests triggered `window.scrollTo`, which jsdom does not implement — flooding test output with "Not implemented" stack traces (tests still passed, but the noise obscured real signal).
- **Fix:** Added `window.scrollTo = () => {}` to the shared Vitest `setup.ts`.
- **Files modified:** web/src/test/setup.ts
- **Verification:** Full `npx vitest run` clean (13 passed, no scrollTo noise).
- **Committed in:** `1557120`

---

**Total deviations:** 3 auto-fixed (all Rule 3 blocking-gate fixes). All confined to `web/` scope; no Go BFF / sibling-repo edits; no 01-05 primitives built.
**Impact on plan:** All three were tooling-gate fixes (one stale TS directive, idiomatic ESLint accommodations, one jsdom shim). No production behavior changed; the shell, header-injection, persistence, and toast contracts are all as specified.

## Threat Surface Scan

No new security-relevant surface beyond the plan's `<threat_model>`. T-04-01 (no token in localStorage) is enforced: `grep -c 'operator_token|FlowdToken|Bearer' web/src/app/OperatorContextProvider.tsx` = 0, and the provider persists only `{tenantId,userId,projectId,sessionId}`. T-04-03 (TopBar shows only non-secret env fields) holds — only `env`/`memory_base` rendered. No new npm packages added (T-04-SC).

## Known Stubs

- `web/src/lib/sse.ts` `openSseStream` — intentional Phase-3/4 inheritance stub (plan-scoped, no call sites in Phase 1). Verified: `grep -rn 'openSseStream|sse\.ts' web/src/app/ web/src/components/` = 0.
- Health dots are hardcoded to `status='unknown'` — by design; live polling is Phase 5 / SHELL-02 per UI-SPEC. Not goal-blocking for this plan (Phase 1 ships the visual contract + unknown initial state only).

## Verification Evidence

- `cd web && npx vitest run` — 13 passed (OperatorContext 6, NavBar 4, Toast 2, smoke 1)
- `cd web && npx tsc --noEmit` — exit 0
- `cd web && npm run build` — dist emitted (index.js 465.62 kB / gzip 146.98 kB)
- `cd web && npm run lint` — exit 0 (0 errors, 2 pre-existing shadcn warnings)
- Grep contract: X-Console-Tenant in api.ts = 1; Authorization in api.ts = 0; localStorage in provider = 4; token in provider = 0; fetchEventSource in sse = 2; openSseStream sites in app/components = 0; arrives-in-Phase in memory.tsx = 1; Toaster in main.tsx = 2; config/env in TopBar = 2; Copy error in OperatorContextBar = 2; createMemoryHistory in NavBar.test = 2; X-Console/localStorage in OperatorContextBar = 0.
- node_modules NOT committed; no file deletions; `.planning/config.json` left unstaged/untouched.

## Next Phase Readiness

- The shell is the host frame for all subsequent feature screens. 01-05 (FiveStateWrapper / RawJsonViewer / CopyableId primitives) builds directly on the installed shadcn set and renders inside the shell's Outlet.
- Phases 2/3/4 mount their console UIs at `/memory`, `/flow`, `/chat` (replacing the placeholders) and use `makeApiFetcher(ctx)` for all REST calls; Phase 3/4 inherit `openSseStream`.
- Phase 5 wires live health polling into the existing `HealthDot` (currently fixed at `unknown`).
- **Environment note (honest):** the env indicator's live round-trip against a running BFF was not exercised in this session (BFF not started here); the TopBar query is stubbed in tests and the proxy target is config-correct from 01-02. End-to-end `/api/config/env` verification carries forward with the already-tracked Phase 1 proxy checks.

## Self-Check: PASSED

- All 10 spot-checked created files exist (provider, api.ts, sse.ts, Shell, router, 4 shell components, memory route).
- Both task commits present in history: `821536a` (Task 1), `1557120` (Task 2).

---
*Phase: 01-foundation*
*Completed: 2026-06-03*
