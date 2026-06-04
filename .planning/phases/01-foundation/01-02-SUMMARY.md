---
phase: 01-foundation
plan: 02
subsystem: ui
tags: [vite, react19, typescript, tailwind-v4, shadcn, vitest, tanstack-router, tanstack-query]

# Dependency graph
requires:
  - phase: 01-01
    provides: "Go BFF on :8090 (GET /api/stream/test synthetic SSE, /healthz) — the Vite dev-proxy target"
provides:
  - "web/ SPA scaffold — Vite 8 + React 19 + TypeScript 5.9.3 (pinned, NOT 6.x)"
  - "Tailwind v4 via @tailwindcss/vite plugin (no tailwind.config.js); index.css @import + UI-SPEC dark-theme hex tokens + .mono class"
  - "shadcn initialized (components.json, radix base) with Phase 1 components in src/components/ui/: button card dialog popover input label tooltip badge separator scroll-area collapsible sonner"
  - "Vite dev proxy /api/* -> http://localhost:8090 (mirrors prod nginx single-origin routing)"
  - "Vitest 4.1.8 harness (jsdom + globals + @testing-library/jest-dom matchers); smoke test green baseline"
  - "main.tsx React 19 entry: StrictMode > QueryClientProvider > RouterProvider (placeholder root route)"
  - "@ -> src path alias wired in tsconfig + vite + vitest"
affects: [phase-01-03-auth-boundary, phase-01-04-app-shell, phase-01-05-primitives, phase-02-memory, phase-03-flow, phase-04-chat]

# Tech tracking
tech-stack:
  added:
    - "vite 8.0.16, @vitejs/plugin-react 6.x"
    - "react 19.2.6 / react-dom 19.2.6"
    - "typescript 5.9.3 (pinned — overrode scaffold's 6.0.2)"
    - "tailwindcss 4.3.0 + @tailwindcss/vite 4.3.0"
    - "shadcn CLI 4.10.0 (radix base, nova preset) + radix-ui, class-variance-authority, clsx, tailwind-merge, tw-animate-css"
    - "@tanstack/react-router 1.170.11, @tanstack/react-query 5.101.0, @tanstack/react-query-devtools 5.101.0"
    - "@microsoft/fetch-event-source 2.0.1, sonner 2.0.7, lucide-react 1.17.0, react-hook-form 7.77.0, zod 4.4.3"
    - "vitest 4.1.8, @testing-library/react 16.3.2, @testing-library/jest-dom 6.6.3, jsdom 26.1.0"
  patterns:
    - "Tailwind v4 plugin-only setup: @import \"tailwindcss\" + @tailwindcss/vite (no PostCSS / no tailwind.config.js)"
    - "Single fixed dark operator theme — UI-SPEC hex tokens authoritative in :root (shadcn light oklch defaults overridden)"
    - "Vite dev proxy mirrors prod nginx single-origin (/api -> BFF), no path rewrite"
    - "vitest.config.ts kept separate from vite.config.ts so the dev proxy never loads under test"

key-files:
  created:
    - web/package.json
    - web/vite.config.ts
    - web/vitest.config.ts
    - web/tsconfig.json
    - web/tsconfig.app.json
    - web/index.html
    - web/index.css (web/src/index.css)
    - web/src/main.tsx
    - web/src/test/setup.ts
    - web/src/test/smoke.test.ts
    - web/components.json
    - web/src/lib/utils.ts
    - web/src/components/ui/*.tsx (12 shadcn components)
    - web/eslint.config.js
  modified: []

key-decisions:
  - "Pinned TypeScript to exactly 5.9.3 — the Vite scaffold installed 6.0.2 (RESEARCH Pitfall 3); overrode in package.json and reinstalled"
  - "shadcn 4.10.0 CLI uses --base radix + --preset nova (the old New York style / zinc base-color flags are gone); preset is cosmetic since UI-SPEC tokens override the palette"
  - "Kept UI-SPEC dark-theme hex tokens authoritative in :root rather than shadcn's light oklch defaults — single fixed dark theme, no toggle (UI-SPEC)"
  - "sonner Toaster hardcoded to theme=\"dark\" and next-themes dependency dropped — the app has no ThemeProvider and is dark-only"

patterns-established:
  - "Tailwind v4 + Vite plugin (no config file) as the styling substrate for all later SPA plans"
  - "shadcn ui components live in src/components/ui/ and are owned/vendored; ESLint allows their *Variants co-exports"
  - "Vitest jsdom + jest-dom harness is the test baseline every later component test plugs into"

requirements-completed: [SHELL-01]

# Metrics
duration: 18min
completed: 2026-06-03
---

# Phase 1 Plan 02: SPA Scaffold Summary

**React 19 + Vite 8 SPA scaffolded with TypeScript pinned to 5.9.3, Tailwind v4 via the @tailwindcss/vite plugin (UI-SPEC dark-theme hex tokens), shadcn 4.10.0 initialized with 12 Phase-1 components, a green Vitest/jsdom harness, and a QueryClientProvider + TanStack Router entry — with the Vite dev proxy routing /api/* to the Go BFF on :8090.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-03T06:34:00Z
- **Completed:** 2026-06-03T06:51:27Z
- **Tasks:** 2 of 2
- **Files created:** 34 tracked under web/ (node_modules NOT committed)

## Accomplishments

- Vite + React 19 + TS 5.9.3 scaffold with Tailwind v4 (plugin-only), shadcn init, and 12 owned UI components — all package versions pinned per RESEARCH.
- Vite dev proxy `/api -> http://localhost:8090` mirrors the prod nginx single-origin routing (no path rewrite — BFF keeps the `/api` prefix).
- Vitest 4.1.8 + jsdom + jest-dom harness green (smoke baseline); `main.tsx` wires React 19 StrictMode > QueryClientProvider > RouterProvider with a placeholder root route for Plan 04 to replace.
- Full toolchain verified green in this environment: `npm run build`, `npx vitest run`, `npx tsc --noEmit`, `npm run lint` (no token/secret leakage in `web/src` or `web/dist`).

## Task Commits

Each task was committed atomically:

1. **Task 1: SPA scaffold — Vite + React 19 + TS 5.9.3 + Tailwind v4 + shadcn init** - `a4372e6` (feat)
2. **Task 2: Vitest + test harness + TanStack Router entry** - `b63aef9` (feat)

**Plan metadata:** committed separately with this SUMMARY + STATE/ROADMAP updates.

## Files Created/Modified

- `web/package.json` - Pinned dependency set; `typescript: 5.9.3` explicit in devDependencies; `test`/`typecheck` scripts.
- `web/vite.config.ts` - `@tailwindcss/vite` plugin, `@` -> src alias, dev proxy `/api -> :8090` (changeOrigin, no rewrite).
- `web/vitest.config.ts` - jsdom env, `globals: true`, setup file, `src/**/*.test.{ts,tsx}` include.
- `web/tsconfig.json` / `web/tsconfig.app.json` - `strict`, `target ES2022`, `moduleResolution bundler`, `jsx react-jsx`, `@/*` paths, test type packages.
- `web/index.html` - Vite SPA entry mounting `/src/main.tsx`.
- `web/src/index.css` - `@import "tailwindcss"` first line; UI-SPEC dark-theme hex tokens in `:root`; `.mono` class; shadcn `@theme inline`/`.dark`/`@layer base` retained, font set to UI-SPEC system-ui stack.
- `web/src/main.tsx` - React 19 entry: QueryClient + TanStack Router placeholder root route.
- `web/src/test/setup.ts` - `@testing-library/jest-dom/vitest` matchers.
- `web/src/test/smoke.test.ts` - Wave 0 green baseline.
- `web/components.json` + `web/src/lib/utils.ts` + `web/src/components/ui/*.tsx` - shadcn config + 12 Phase-1 components.
- `web/eslint.config.js` - Flat config + shadcn `components/ui/**` `*Variants` co-export allowance.

## Decisions Made

See `key-decisions` frontmatter. Headline: TypeScript pinned to 5.9.3 (scaffold tried 6.0.2); shadcn 4.10.0's new `--base/--preset` flag model used; UI-SPEC dark hex tokens kept authoritative over shadcn's light oklch defaults; sonner pinned to a fixed dark theme (next-themes dropped).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unresolvable `shadcn/tailwind.css` + geist font @imports added by the shadcn nova preset**
- **Found during:** Task 2 (build verification)
- **Issue:** `npm run build` failed: `Can't resolve 'shadcn/tailwind.css'`. The shadcn nova preset injected `@import "shadcn/tailwind.css"` and `@import "@fontsource-variable/geist"` into index.css; the `shadcn` package is a CLI (correctly not a runtime dep), so the import cannot resolve at build time.
- **Fix:** Removed both `@import` lines; pointed `@theme inline`'s `--font-sans` at the UI-SPEC system-ui sans stack (UI-SPEC mandates system fonts, not Geist); removed the unused `@fontsource-variable/geist` dependency. The inline `@theme`/`:root`/`.dark`/`@layer base` blocks already define everything the components need.
- **Files modified:** web/src/index.css, web/package.json, web/package-lock.json
- **Verification:** `npm run build` succeeds (144 modules, dist emitted); `grep -r 'Bearer' web/dist` returns 0.
- **Committed in:** b63aef9 (Task 2 commit)

**2. [Rule 3 - Blocking] ESLint errored on shadcn `button.tsx`/`badge.tsx` `*Variants` co-exports**
- **Found during:** Task 2 (lint gate)
- **Issue:** `npm run lint` returned 2 errors: `react-refresh/only-export-components` fires because shadcn's vendored `button.tsx` and `badge.tsx` export both a component and a `buttonVariants`/`badgeVariants` (class-variance-authority) constant — a deliberate shadcn pattern, not a defect in our code.
- **Fix:** Added a flat-config override for `src/components/ui/**` setting `react-refresh/only-export-components` to `warn` with `allowConstantExport: true` (the conventional shadcn ESLint accommodation), rather than restructuring generated files.
- **Files modified:** web/eslint.config.js
- **Verification:** `npm run lint` exits 0 (2 warnings, 0 errors).
- **Committed in:** b63aef9 (Task 2 commit)

**3. [Rule 1 - Bug] Hardcoded sonner Toaster to dark theme; dropped next-themes**
- **Found during:** Task 1 (component install)
- **Issue:** The shadcn `sonner.tsx` imports `next-themes`' `useTheme`, which requires a `ThemeProvider` that does not exist in this single fixed-dark app — `useTheme` would silently fall back to `"system"`, and `next-themes` becomes an unused dependency.
- **Fix:** Set `theme="dark"` directly on the Toaster and removed the `next-themes` dependency (UI-SPEC: one fixed dark operator theme, no toggle).
- **Files modified:** web/src/components/ui/sonner.tsx, web/package.json
- **Verification:** `npm run build` + `tsc --noEmit` pass; no `next-themes` import remains.
- **Committed in:** a4372e6 (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 blocking). All confined to `web/` scope; no Go BFF / sibling-repo edits.
**Impact on plan:** All three were necessary to make the build/lint gates pass and to honor the UI-SPEC single-dark-theme contract. No scope creep — the dependency set and component list match the plan; the removed imports/deps were preset noise, not planned stack.

## Issues Encountered

- shadcn CLI 4.10.0 changed its flag surface vs. the plan's assumption (the plan referenced "New York style, zinc base color"). 4.10.0 has no `--style`/`--base-color`; it uses `--base radix|base` (component library) and `--preset` (nova/vega/…). Resolved by running `init --template vite --base radix --preset nova --yes`. The preset palette is irrelevant because the UI-SPEC hex tokens override `:root`.

## User Setup Required

None - no external service configuration required. (To run the SPA against the BFF: `cd web && npm install && npm run dev`, with the Go BFF from Plan 01-01 running on :8090.)

## Next Phase Readiness

- SPA foundation is ready for Plan 01-03 (auth boundary — BFF-side, no SPA change needed) and Plan 01-04 (app shell: replaces the placeholder root route with the nav + operator-context bar + env indicator and the named Memory/Flow/Chat routes).
- All Phase 1 shadcn primitives are installed; the five-state / raw-JSON / copyable-id / operator-context primitives (Plan 01-05) can be built directly on them.
- No blockers. The dev proxy is config-correct; live `/api` round-trips through Vite -> BFF were not exercised here (the BFF is not running in this session) but the proxy target matches Plan 01-01's :8090 BFF.

## Known Stubs

- `web/src/main.tsx` uses a placeholder root route that renders `Loading…`. This is by plan design — Plan 01-04 replaces the route tree with the full app shell and named routes. Not a goal-blocking stub for this plan (the plan's goal is the scaffold + harness, both delivered and green).

## Self-Check: PASSED

- FOUND: web/package.json, web/vite.config.ts, web/vitest.config.ts, web/tsconfig.json, web/index.html, web/src/index.css, web/src/main.tsx, web/src/test/setup.ts, web/src/test/smoke.test.ts, web/components.json, web/src/components/ui/ (12 components)
- FOUND commit: a4372e6 (Task 1)
- FOUND commit: b63aef9 (Task 2)
- Gates green in this environment: npm run build (dist emitted), npx vitest run (1 passed), npx tsc --noEmit (exit 0), npm run lint (exit 0, warnings only); token scans (web/src, web/dist) return 0.

---
*Phase: 01-foundation*
*Completed: 2026-06-03*
