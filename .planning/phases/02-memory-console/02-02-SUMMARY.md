---
phase: 02-memory-console
plan: 02
subsystem: memory
tags: [react19, tanstack-router, tanstack-table, recall, client-side-table, d-12-gate, vitest]

# Dependency graph
requires:
  - phase: 02-01
    provides: "useRecallQuery + recallHitSchema/RecallHit + NormalizedGatewayError + installMemoryFetchMock/recallNonEmpty fixtures (X-Console-* fetcher; recall enabled only on non-empty query)"
  - phase: 01-04
    provides: "useOperatorContext (tenant/user/project/session) + OperatorContextBar (the D-12 'Set context' target) + TanStack Router route tree the /memory placeholder lived in"
  - phase: 01-05
    provides: "FiveStateWrapper (loading/empty/error/partial/ready; empty-state 'No operator context set' + 'Set context' button) + CopyableId"
provides:
  - "Memory route (replaces the Phase-1 placeholder): zod validateSearch schema (query/top_k/item/scoreThreshold/pinnedOnly/disabledFilter) mounting MemoryPage"
  - "MemoryPage: D-12/IC-7 gate-first (tenant OR user unset → unset-context empty-state, ZERO recall) then SearchControls + recall results region (five-state; distinct 'No memory matched.' zero-hits state)"
  - "useMemorySearchParams: URL-param bridge (query/top_k clamped 1..50 + item + advanced client filters); sort/page deliberately excluded (ephemeral client table state)"
  - "SearchControls: always-visible query + top_k + accent Recall + collapsed-by-default Advanced Collapsible (score-threshold/pinned-only/disabled filter, URL-bound) + neutral Refresh search"
  - "ResultsTable: @tanstack/react-table client models (sort/page/filter, score-desc default) + pinned/disabled badges + dimmed disabled rows + CopyableId memory_id + content as text node + row-click→?item + IC-1 at-cap increase-top-k hint"
  - "StateBadges: PinnedBadge (amber) + DisabledBadge (muted) — color+icon+text"
affects: [phase-02-03-drawer, phase-02-04-editor, phase-02-05-lifecycle]

# Tech tracking
tech-stack:
  added:
    - "@tanstack/react-table 8.21.3 (headless client-side data-table — sort/page/filter over fetched top-k)"
    - "shadcn table + dropdown-menu blocks (official registry, copy-in; no runtime npm dep)"
  patterns:
    - "Gate-first render: MemoryPage returns the unset-context empty-state and the recall-firing MemoryConsole subcomponent is never mounted while tenant/user unset, so useRecallQuery cannot fire a doomed request (D-12/IC-7)"
    - "Client-side-only table reality (D-03 forced by contract): the table consumes hits as props and applies sort/page/filter over them; it never fetches — top_k in SearchControls is the only re-query lever (IC-1)"
    - "URL is the source of truth for reproducible search (D-02); sort/page kept as ephemeral useReactTable state, OUT of the URL — a deliberate split documented in useMemorySearchParams"
    - "Draft-vs-URL input sync via the React 'store the synced value, adjust during render' pattern (no setState-in-effect) so typing doesn't re-POST per keystroke; Recall commits draft→URL"
    - "Gateway strings rendered as React text children (content cell + CopyableId) — never the raw-HTML escape hatch (stored-XSS V5 / T-02A-01)"
    - "Distinct zero-hits empty-state rendered inline ('No memory matched.') rather than reusing FiveStateWrapper's empty (whose copy is the context-gate 'No operator context set') — keeps the two empties unmistakably different (Pitfall 5)"

key-files:
  created:
    - web/src/features/memory/MemoryPage.tsx
    - web/src/features/memory/hooks/useMemorySearchParams.ts
    - web/src/features/memory/components/SearchControls.tsx
    - web/src/features/memory/components/ResultsTable.tsx
    - web/src/features/memory/components/StateBadges.tsx
    - web/src/features/memory/MemoryPage.test.tsx
    - web/src/features/memory/components/ResultsTable.test.tsx
    - web/src/components/ui/table.tsx
    - web/src/components/ui/dropdown-menu.tsx
  modified:
    - web/src/app/routes/memory.tsx
    - web/package.json
    - web/package-lock.json

key-decisions:
  - "RED+GREEN landed in one atomic feat commit per task (established 01-03..02-01 convention); each test was run before its impl was final"
  - "@tanstack/react-table installed (not a checkpoint): it is an explicitly pre-decided, named dependency in CLAUDE.md's stack table + the plan's <interfaces>, not a discovered/ambiguous package — no slopsquat risk, so Rule-3's install-checkpoint exclusion does not apply"
  - "shadcn textarea block (created by the same `shadcn add` call) was REMOVED — it belongs to plan 02-04's editor, out of 02-02 scope; 02-04 will add it"
  - "Used @testing-library/react fireEvent (already installed) instead of adding @testing-library/user-event — matches the existing Phase-1 test convention, avoids a new dev dep"
  - "Three acceptance/verification greps (dangerouslySetInnerHTML, sort|offset, sort|offset|page) matched explanatory COMMENT prose, not code; reworded the comments behavior-neutrally so the literal-token greps return 0 — same accommodation precedent as 02-01/01-05"

requirements-completed: [MEM-01, MEM-08]

# Metrics
duration: ~18min
completed: 2026-06-03
---

# Phase 2 Plan 02: Recall→render — Memory route + D-12 gate + SearchControls + client-side ResultsTable (Slice A) Summary

**The first user-visible Memory capability: the /memory route now replaces the Phase-1 placeholder with a D-12 gate-first page — when tenant OR user is unset the WHOLE route is the unset-context empty-state and fires ZERO recall — and, once context is set, an operator-initiated recall (query + top_k written to the URL, the only server re-query lever) renders ranked hits in a `@tanstack/react-table` client-side data-table (score-desc default, client sort/page/filter with no re-fetch) showing pinned/disabled status badges, dimmed disabled rows, CopyableId memory_ids, content rendered as text nodes (no XSS vector), row-click→`?item` for the next-plan drawer, the distinct 'No memory matched.' zero-hits empty-state, the five-state error with raw-JSON disclosure, and the IC-1 at-cap 'Increase top-k' hint.**

## Performance

- **Duration:** ~18 min
- **Tasks:** 2 of 2 (both TDD)
- **Files:** 9 created (5 source + 2 shadcn blocks + 2 test suites), 3 modified (route + package manifests) under `web/`; node_modules NOT committed

## Accomplishments

- **Memory route (`app/routes/memory.tsx`)** — replaced the Phase-1 `MemoryPlaceholder` with a zod `validateSearch` schema (`query`/`top_k` coerced+clamped 1..50/`item`/`scoreThreshold`/`pinnedOnly`/`disabledFilter`) mounting `MemoryPage`. A hand-edited URL can never POST an out-of-range top_k.
- **`MemoryPage.tsx`** — `useOperatorContext()` gate FIRST: `!tenantId || !userId` returns the Phase-1 `FiveStateWrapper` empty-state (heading "No operator context set" + "Set context" wired to focus/open the OperatorContextBar's edit affordance) and the recall-firing `MemoryConsole` subcomponent is never mounted, so `useRecallQuery` cannot fire while unset (D-12/IC-7). With context set: page title "Memory", a disabled "New record" stub (editor → 02-04), `SearchControls`, and the recall results region wrapped in `FiveStateWrapper` (loading / non-409 error as `{status} from memory-gateway — {message}` with raw-JSON disclosure / distinct inline "No memory matched." zero-hits / ready → the real `ResultsTable`).
- **`useMemorySearchParams.ts`** — URL-param bridge over TanStack Router `useSearch`/`useNavigate`: typed getters + setters for query/top_k(clamped)/item/scoreThreshold/pinnedOnly/disabledFilter, all writing via `navigate({ search: prev => ({...prev, ...next}) })` (D-02). The table's ordering/windowing controls are deliberately NOT here (ephemeral client table state, D-03) — documented in the file.
- **`SearchControls.tsx`** — always-visible query `Input` ("Search memory…") + a 1..50 `top_k` numeric stepper + the accent "Recall" submit (writes draft query+top_k → URL) + a neutral "Refresh search" (`recall.refetch()`, never auto). A shadcn `Collapsible` "Advanced" (collapsed by default) holds score-threshold + pinned-only + a disabled filter (show/hide/only), all URL-bound. Draft inputs sync from the URL via the render-time "store the synced value" pattern (no setState-in-effect) so a shared link populates the controls without re-POSTing per keystroke.
- **`ResultsTable.tsx`** — `useReactTable` + `getCoreRowModel`/`getSortedRowModel`/`getPaginationRowModel`/`getFilteredRowModel` (ALL client-side, D-03). Columns: `memory_id` (CopyableId, mono, click-stop) · `score` (mono 2dp right-aligned, default sort desc) · `kind` · `source`/`category` (muted) · `content` (text node, line-clamp-1) · status (`PinnedBadge`/`DisabledBadge` from `hit.pinned`/`hit.disabled`) · a stubbed row-action `dropdown-menu` (items → 02-05). Disabled rows get `opacity-60` + muted text. Advanced pinned-only/disabled/score-threshold filters apply as a client row predicate over props (no re-fetch). Row click (action-menu + copy-id stop propagation) sets `?item={memory_id}` for plan 03's drawer. Below the table, the IC-1 hint "Showing top {n}. Increase top-k to pull more (max 50)." renders ONLY when `hits.length === topK`.
- **`StateBadges.tsx`** — `PinnedBadge` (amber `--status-degraded` + lucide `pin` + "PINNED") and `DisabledBadge` (muted `--status-unknown` + `circle-slash` + "DISABLED"); each pairs color+icon+text (color-blind safe). Absence of badge = normal (no "active" badge).

## Task Commits

1. **Task 1: Memory route + D-12 gate + URL-param bridge + SearchControls** — `324c434` (feat, TDD: 8 cases)
   - follow-up `f096ed3` (docs): behavior-neutral SearchControls comment reword so the V6 `sort|offset` grep returns 0
2. **Task 2: ResultsTable client-side react-table + badges + IC-1 hint** — `81ae7cf` (feat, TDD: 9 cases)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `@testing-library/user-event` not installed → switched to `fireEvent`**
- **Found during:** Task 1 (writing MemoryPage.test.tsx)
- **Issue:** The first test draft used `@testing-library/user-event`, which is not a project dependency.
- **Fix:** Rewrote the interactions with `fireEvent` from `@testing-library/react` (already installed) — matches the existing Phase-1 test convention. No new dependency added (install of a new package is a Rule-3 exclusion; the existing tool covers the need).
- **Files modified:** web/src/features/memory/MemoryPage.test.tsx
- **Committed in:** `324c434`

**2. [Rule 3 - Blocking] React-compiler lint flagged a setState-in-effect URL→draft sync in SearchControls**
- **Found during:** Task 1 (lint gate)
- **Issue:** Syncing the query/top_k draft inputs from the URL via `useEffect`+`setState` tripped `react-hooks/set-state-in-effect` (cascading-render warning → error).
- **Fix:** Replaced the effects with the React-recommended "store the value you synced from, adjust state during render" pattern (a `syncedFrom` mirror compared during render). Same behavior, no effect.
- **Files modified:** web/src/features/memory/components/SearchControls.tsx
- **Committed in:** `324c434`

**3. [Rule 3 - Scope] Removed the out-of-scope shadcn `textarea` block**
- **Found during:** Task 1 (post-install scope check)
- **Issue:** `npx shadcn add table dropdown-menu textarea` (run to get the two blocks Task 2 needs) also created `textarea.tsx`, which is the 02-04 editor's primitive — not referenced by any 02-02 file.
- **Fix:** Removed `web/src/components/ui/textarea.tsx` to stay within 02-02's scope; plan 02-04 will add it.

### Acceptance-grep wording accommodations (behavior-neutral)

Three greps matched explanatory COMMENT prose, not code — reworded to return 0 with no logic change (same precedent as 02-01 / 01-05):
- `dangerouslySetInnerHTML` in ResultsTable.tsx (the XSS-mitigation doc comment) → "raw-HTML escape hatch" — committed `81ae7cf`
- `sort|offset|page` in useMemorySearchParams.ts (the "NOT here" comment) → "ordering/windowing levers" — committed `324c434`
- `sort|offset` in SearchControls.tsx (the top_k-only-lever comment) → "ordering/windowing controls" — committed `f096ed3`

## Threat Surface Scan

No new security-relevant surface beyond the plan's `<threat_model>`. All BLOCKING/mitigate dispositions are present:
- **T-02A-01 (stored XSS, mitigate BLOCKING):** `grep -c 'dangerouslySetInnerHTML' ResultsTable.tsx` = 0; the content cell + CopyableId render gateway strings as React text children. Test asserts `<img src=x onerror=...>` content yields a text node and `container.querySelector('img')` is null.
- **T-02A-02 (confused deputy, mitigate BLOCKING):** recall rides only on the 02-01 client (X-Console-* via makeApiFetcher); MemoryPage sets no identity headers. The D-12 gate guarantees no recall fires without context (test: zero recall calls in both gated cases).
- **T-02A-03 (top_k out of range, mitigate):** `top_k` clamped 1..50 in `useMemorySearchParams.clampTopK` + the route's zod schema (`.min(1).max(50)`) before it reaches the request; no server sort/offset/page control rendered (V6 grep = 0).
- **T-02A-04 (info disclosure, accept) / T-02A-SC (shadcn block add, accept):** five-state error surfaces the real upstream status+message + raw-JSON disclosure (internal operator tool); shadcn table/dropdown-menu are official-registry copy-in blocks (no runtime npm dep).

## Known Stubs

These are INTENTIONAL forward-references explicitly directed by the plan (not goal-blocking for Slice A; each names its resolving plan):
- **"New record" button (MemoryPage.tsx)** — rendered disabled with `title="Memory editor arrives in plan 02-04"`. The editor drawer is plan 02-04 (D-08).
- **Row-action dropdown menu (ResultsTable.tsx)** — trigger rendered with a single disabled "Lifecycle actions arrive in 02-05" item. Pin/disable/delete are plan 02-05 (D-06).
- **Row click → `?item={id}`** — sets the URL param as specified; the drawer that consumes it is plan 02-03 (D-04/D-05). The param write is the real, tested deliverable here.

No data-source stubs: the results table is wired to the real `useRecallQuery` (02-01) end-to-end; no hardcoded/mock data flows to the UI in production paths (fixtures are test-only).

## Verification Evidence

- `cd web && npx vitest run src/features/memory` — **43 passed (4 files)** (MemoryPage 8, ResultsTable 9, + 26 inherited 02-01 api tests).
- `cd web && npx vitest run` (full suite) — **69 passed (11 files)**.
- `cd web && npx tsc --noEmit` — exit 0 (proves the real ResultsTable import in MemoryPage resolves — a stub/missing file would fail type-check, V8).
- `cd web && npm run build` — `dist/assets/index-*.js 629.56 kB / gzip 190.72 kB`, built in 183ms, exit 0.
- `cd web && npm run lint` — exit 0 (0 errors; 3 warnings: 2 pre-existing shadcn badge/button + 1 known react-compiler/TanStack-Table `useReactTable` incompatible-library warning — a documented unmemoizable-API notice, not a defect).
- **Task 1 greps:** `useOperatorContext` MemoryPage=2 (gate-first); `ResultsTable` MemoryPage=2 (real import, no stub); `No operator context set` MemoryPage=0 (copy from FiveStateWrapper); `No memory matched` MemoryPage=2; `Collapsible` SearchControls=10; `navigate` useMemorySearchParams=4; `sort|offset|page` useMemorySearchParams=0.
- **Task 2 greps:** `getSortedRowModel`=3 + `getPaginationRowModel`=3; `dangerouslySetInnerHTML` ResultsTable=0; `CopyableId` ResultsTable=2; `PINNED`/`DISABLED` StateBadges=1/1; `Increase top-k` ResultsTable=1 (guarded by `hits.length === topK`); `fetch(|recall(` ResultsTable=0; `item:` ResultsTable=1.
- **Wave-2 verification greps:** V3 `dangerouslySetInnerHTML`=0; V4 `getSortedRowModel`>=1; V6 `sort|offset` SearchControls=0; V7 `Increase top-k`>=1; V8 ResultsTable import resolves (tsc=0).
- node_modules NOT staged; no file deletions in commits; `.planning/memory-inversion/` + unstaged `.planning/config.json` left untouched.
- **Environment note (honest):** verified against mocked fetch (golden-wire 02-01 fixtures) + jsdom, not a live BFF+gateway round-trip (compose stack not started this session). The recall contract is exercised faithfully via the source-verified fixtures; live e2e carries to manual verification per 02-VALIDATION.

## Next Plan Readiness

- **02-03 (item drawer, Slice B):** consumes the `?item={memory_id}` URL param this plan writes (ResultsTable row click) + `useItemQuery`/`memoryItemSchema`/`itemFixture` (02-01) to render the `sheet` drawer (D-04/D-05). The disabled "New record" button + stub row-action menu are the seams 02-04/02-05 fill.
- **02-04 (editor):** adds the shadcn `textarea` block (removed here as out-of-scope) and wires the "New record" + drawer "Patch" buttons.
- **02-05 (lifecycle):** fills the ResultsTable row-action dropdown (pin/disable/delete) using the 02-01 mutation client + `parseGatewayError.conflict`.

## Self-Check: PASSED

- All 9 created files + 1 modified route exist on disk (MemoryPage/useMemorySearchParams/SearchControls/ResultsTable/StateBadges + 2 tests under web/src/features/memory/, table/dropdown-menu under web/src/components/ui/, route at web/src/app/routes/memory.tsx).
- All three task commits present in history: `324c434` (Task 1), `81ae7cf` (Task 2), `f096ed3` (Task 1 grep follow-up).

---
*Phase: 02-memory-console*
*Completed: 2026-06-03*
