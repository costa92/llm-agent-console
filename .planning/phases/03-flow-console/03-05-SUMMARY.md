---
phase: 03-flow-console
plan: 05
subsystem: flow-ui
tags: [flow, run-history, react-table, sub-route, replay, instant-fill, live, sse, empty-events, deep-link, vitest]

# Dependency graph
requires:
  - phase: 03-flow-console
    plan: 04
    provides: "TimelineView (mode='replay' disables auto-scroll; onRetry→retry()) + NodeStatusList + ConnectionBadge + RunResultPanel; RunTrigger streamed-Run X-Run-ID navigation (with the cast this plan removes)"
  - phase: 03-flow-console
    plan: 03
    provides: "useRunStream (start/replay/retry, X-Run-ID→onRunId, terminal/unmount abort) + the pure (kind,node,ordinal)-de-duping timelineReducer — the SINGLE code path for live + replay"
  - phase: 03-flow-console
    plan: 02
    provides: "FlowDetailPage Runs-tab run-history placeholder slot + the three flow routes + the routeTree (router.tsx) + FlowsTable react-table/FiveStateWrapper pattern"
  - phase: 03-flow-console
    plan: 01
    provides: "listRuns/getRun/listRunEvents REST + flowKeys.runs/run/runEvents + useRunsQuery/useRunQuery/useRunEventsQuery + installFlowdFetchMock + runsListFixture/runRecordFixture/runEventsFixture/runEventsEmpty + the fake SSE emitter (makeFakeSseStream/goldenSuccess)"
  - phase: 01-foundation
    provides: "CopyableId, FiveStateWrapper, RawJsonViewer, Badge, Button, Table primitives, --status-* tokens"
provides:
  - "RunsHistory — react-table over GET /flows/{id}/runs on the flow-detail Runs tab (run_id CopyableId · run-status badge running/done/failed · started_at/finished_at mono, running→'—'); FiveStateWrapper loading/verbatim-error/'No runs yet.' empty; row click → the run sub-route"
  - "RunStatusBadge — the shared run-status badge (Color (d): running muted-spin / done green / failed red, color+icon+text) used by BOTH the history table and the run-detail summary"
  - "runDetailRoute /flows/$flowId/runs/$runId (registered in routes/flow.tsx + router.tsx) — the SINGLE deep-linkable render location for BOTH live and replay; browser-back → flow detail"
  - "RunDetailPage + RunDetail — the run sub-route body: getRun summary (status badge + timestamps + inputs/outputs/error via RawJsonViewer) + the SAME Plan-04 TimelineView/NodeStatusList/ConnectionBadge/RunResultPanel fed by useRunStream; TERMINAL→replay instant-fill (mode=replay), RUNNING→live tail (mode=live, Streaming); empty /events→'No events recorded.' empty state; Replay CTA hidden while running"
affects: [04-chat-console (SSE timeline + run-detail patterns), phase-3 manual through-nginx SSE gate now observed AT the run sub-route]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "The run sub-route is the SINGLE render location for BOTH live and replay (D-08): RunDetail mounts the Plan-04 components fed by the Plan-03 useRunStream, branching on getRun status — TERMINAL→replay(runId) instant-fill (mode='replay', no playback), RUNNING→live tail (mode='live', ConnectionBadge Streaming). Replay==live is proven by feeding the same golden sequence through the same reducer/renderer."
    - "Empty-events (Pitfall 7) is detected via the AUTHORITATIVE useRunEventsQuery REST probe (200 {events:[]} → []), NOT off the SSE clean-close (a clean replay close emits no connection 'terminal', so conn stays 'streaming' — it cannot distinguish 'ended' from 'ended empty'). Only when the probe reports events does RunDetail open the replay stream; an empty probe renders 'No events recorded.' and never opens a stream."
    - "RunStatusBadge is exported from RunsHistory.tsx and reused verbatim in the run-detail summary so the history row and the run header show the IDENTICAL Color (d) badge — no second badge component."
    - "The run sub-route registration RETIRES the 03-04 navigate seam: RunTrigger's documented `navigate({ to } as Parameters<...>[0])` cast is replaced with the typed `navigate({ to: '/flows/$flowId/runs/$runId', params })`; RunsHistory + FlowsTable navigate the same typed route. tsc -b (strict) now passes with no cast."
    - "All flowd strings (run ids, timestamps, inputs/outputs/error, frame payloads) render as React TEXT nodes / escaped raw-JSON — never dangerouslySetInnerHTML (T-03-V5), asserted with markup-bearing run id + error payloads."

key-files:
  created:
    - web/src/features/flow/components/RunsHistory.tsx
    - web/src/features/flow/components/RunsHistory.test.tsx
    - web/src/features/flow/components/RunDetail.tsx
    - web/src/features/flow/components/RunDetail.test.tsx
    - web/src/features/flow/RunDetailPage.tsx
  modified:
    - web/src/app/routes/flow.tsx
    - web/src/app/router.tsx
    - web/src/features/flow/FlowDetailPage.tsx
    - web/src/features/flow/components/RunTrigger.tsx

key-decisions:
  - "03-05: the run sub-route /flows/$flowId/runs/$runId is the SINGLE live+replay render location (D-08) — RunDetail mounts the Plan-04 TimelineView/NodeStatusList/ConnectionBadge/RunResultPanel fed by useRunStream and branches on getRun status: TERMINAL→replay(runId) instant-fill (mode='replay'), RUNNING→live tail (mode='live', Streaming)"
  - "03-05: empty-events is read from the authoritative useRunEventsQuery REST probe (200 {events:[]}→[]), NOT the SSE clean-close — a clean replay close emits no connection 'terminal', so conn stays 'streaming' and cannot signal 'ended empty'. RunDetail opens the replay stream only when the probe reports events; an empty probe renders 'No events recorded.' (Pitfall 7), never opening a stream"
  - "03-05: RunStatusBadge is exported from RunsHistory.tsx and reused in the run-detail summary so the row + the header show the IDENTICAL Color (d) badge"
  - "03-05: registering runDetailRoute RETIRES the 03-04 RunTrigger navigate cast — replaced with the typed navigate({ to: '/flows/$flowId/runs/$runId', params }); strict tsc -b now passes cast-free"
  - "03-05: a deep-link mid-run live tail relies on replay re-streaming the persisted events-so-far (de-dup-safe); a continuous mid-run live FOLLOW after a fresh deep-link is a Phase-5 reconnect concern (STATE Phase-5 blocker), consistent with the hook's current replay/retry surface"

requirements-completed: [FLOW-05, FLOW-06]

# Metrics
duration: 8min
completed: 2026-06-04
---

# Phase 3 Plan 05: Run History + the Single Live+Replay Run Sub-Route (Slice C) Summary

**The runs-history react-table on the flow-detail Runs tab + the deep-linkable run sub-route `/flows/{id}/runs/{runId}` made — per D-08 — the ONE place BOTH live runs and replays render: RunDetail mounts the Plan-04 TimelineView/NodeStatusList/ConnectionBadge/RunResultPanel fed by the Plan-03 reducer/hook and branches on `getRun` status (TERMINAL → `replay(runId)` instant-fill via the SAME reducer, no playback; RUNNING → live tail with ConnectionBadge Streaming), with empty `/events` rendered as the 'No events recorded.' empty state (not an error) and the Replay CTA hidden while running. Registering the typed route also retired the 03-04 navigate cast — strict `tsc -b` now passes cast-free. Phase 3 complete (5/5).**

## Performance
- **Duration:** ~8 min
- **Started:** 2026-06-04T03:31Z
- **Completed:** 2026-06-04T03:39Z
- **Tasks:** 2
- **Files:** 9 (5 created, 4 modified)

## Accomplishments

### Task 1 — Runs-history table on the Runs tab (commit `d34f1da`)
- **RunsHistory** is a client-side `@tanstack/react-table` over `useRunsQuery(flowId)` → `{runs:[RunMeta]}` (sort + pagination client-side; mirrors the Slice-A FlowsTable / Phase-2 ResultsTable pattern). Columns per UI-SPEC S7 / IC-7: `run_id` (CopyableId mono) · run-status badge (Color (d)) · `started_at` / `finished_at` (mono Label; `finished_at` omitted while running → `"—"`). Wrapped in the Phase-1 FiveStateWrapper: loading / verbatim `"{status} from flowd — {error}."` error / a FLOW-specific `"No runs yet."` empty state rendered INSIDE the ready slot (not the primitive's MEM-08 unset-context EmptyState — flowd has no context gate; same convention as FlowsTable). Row click navigates to the typed run sub-route `/flows/$flowId/runs/$runId`.
- **RunStatusBadge** (exported) maps flowd `status ∈ {running, done, failed}` → color+icon+text (running muted-spin / done green / failed red), reused verbatim by the run-detail summary so the row + the run header show the IDENTICAL badge.
- **FlowDetailPage** Runs tab now mounts `<RunsHistory flowId={flowId} />` (replacing the Slice-A placeholder slot).
- All flowd strings render as TEXT nodes (T-03-V5).
- **Tests (5):** rows render with status badges + timestamps + copyable ids (+ a running run's `"—"` finished_at); `"No runs yet."` empty state; verbatim flowd error; row click → the run sub-route (asserted against the clicked row's id under the started_at-desc default sort); a markup-bearing run id renders escaped (no `<img>`).

### Task 2 — Run sub-route = single live+replay render location (commit `5261937`)
- **runDetailRoute** `/flows/$flowId/runs/$runId` registered in `routes/flow.tsx` + the `router.tsx` routeTree; the route reads `$flowId`/`$runId` and renders **RunDetailPage** (a route shell: a back-link to `/flows/$flowId` + header) hosting **RunDetail**. Browser-back returns to the flow detail (the sub-route path nests under it).
- **RunDetail** renders the run SUMMARY from `getRun(runId)` (via `useRunQuery`, FiveStateWrapper): the shared RunStatusBadge + `started_at`/`finished_at` (mono, running→`"—"`) + `inputs`/`outputs`/`error` via the collapsed RawJsonViewer (error string red). It then mounts the **SAME** Plan-04 `TimelineView` (+ its embedded NodeStatusList + ConnectionBadge) + `RunResultPanel`, fed by the Plan-03 `useRunStream`:
  - **TERMINAL** run (done/failed) → on the events probe settling with events, `replay(runId)` INSTANT-FILLS the timeline (`mode='replay'`, no auto-scroll animation); the persisted frames re-stream through the SAME reducer so the render is identical to a live run of those frames; the terminal `flow_done` outputs / `flow_err` error fold into the ONE RunResultPanel.
  - **RUNNING** run → re-streams the events-so-far (de-dup-safe) with `mode='live'` (auto-scroll active) and the ConnectionBadge showing **Streaming**; the D-09 Retry is wired to the hook's `retry()` (the `/events`-hydrate recovery for the known runId — NOT a fresh `/run/stream`).
  - **Empty `/events`** (200 `{events:[]}`) → the `"No events recorded."` empty state, NOT an error (Pitfall 7), detected from the authoritative `useRunEventsQuery` probe; the replay stream is never opened in this case.
  - **Replay CTA** shown on a terminal run (re-fires `replay(runId)`), hidden while `status==='running'` (a running run already shows the live stream — Non-Blocking Rec #4).
- **RunTrigger (03-04)** navigate cast removed — replaced with the now-typed `navigate({ to: '/flows/$flowId/runs/$runId', params: { flowId, runId } })`; strict `tsc -b` passes cast-free.
- All flowd strings render as TEXT / escaped raw-JSON (T-03-V5).
- **Tests (7):** summary renders status badge + timestamps + run id, and replay re-streams the golden sequence into the SAME timeline (`data-mode="replay"`, frame-kind labels present); a terminal run instant-fills all four golden frames + the RunResultPanel (identical to live); a running run tails live (events render + ConnectionBadge **Streaming**, `data-mode="live"`); empty `/events` → `"No events recorded."` empty state, NOT an error, no timeline; Replay hidden while running; Replay shown on a terminal run; a markup-bearing `flow_err` error renders escaped (no `<img>`).

## Task Commits
1. **Task 1: Runs-history table on the Runs tab** — `d34f1da` (feat)
2. **Task 2: Run sub-route = single live+replay render location (D-08) + cast removal** — `5261937` (feat)

**Plan metadata:** _(this commit)_ (docs: complete plan)

## Files Created/Modified
- `web/src/features/flow/components/RunsHistory.tsx` — runs react-table + the exported RunStatusBadge + the `"No runs yet."` empty state.
- `web/src/features/flow/components/RunsHistory.test.tsx` — 5 cases (rows/badges/timestamps/`—`, empty, error, row→sub-route, XSS-escape).
- `web/src/features/flow/components/RunDetail.tsx` — the run-detail body: summary + the SAME live+replay TimelineView/RunResultPanel + empty-events + Replay CTA.
- `web/src/features/flow/components/RunDetail.test.tsx` — 7 cases (summary, terminal instant-fill, running live-tail, empty-events, Replay hidden/shown, XSS-escape).
- `web/src/features/flow/RunDetailPage.tsx` — the run sub-route route shell (back-link + header + RunDetail).
- `web/src/app/routes/flow.tsx` — **modified**: register `runDetailRoute` `/flows/$flowId/runs/$runId`.
- `web/src/app/router.tsx` — **modified**: add `runDetailRoute` to the routeTree.
- `web/src/features/flow/FlowDetailPage.tsx` — **modified**: Runs tab mounts `RunsHistory` (replacing the Slice-A placeholder).
- `web/src/features/flow/components/RunTrigger.tsx` — **modified**: replace the 03-04 navigate cast with the typed `navigate({ to: '/flows/$flowId/runs/$runId', params })`.

## Decisions Made
See `key-decisions` frontmatter. Headline: the run sub-route is the SINGLE live+replay render location (D-08) branching on `getRun` status; empty-events read from the authoritative `useRunEventsQuery` probe (the SSE clean-close cannot signal 'ended empty'); RunStatusBadge shared row↔header; the typed route registration retires the 03-04 navigate cast.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Empty-events detected via the REST `useRunEventsQuery` probe rather than the SSE replay close.**
- **Found during:** Task 2 — designing the `"No events recorded."` state against the Plan-03 hook.
- **Issue:** The plan/behavior phrasing ("the replay settles with zero folded frames") implied reading the empty-events state off the replay stream. But the Plan-03 connection machine only flips to `closed` on a **terminal frame** (`flow_done`/`flow_err`); a clean replay **close** (promise resolve) dispatches no connection event, so `conn` stays `streaming` and cannot distinguish "ended" from "ended empty". Reading empty off the SSE close was therefore impossible without modifying `useRunStream.ts` (out of this plan's `files_modified` scope).
- **Fix:** RunDetail uses the authoritative `useRunEventsQuery(runId)` REST probe (200 `{events:[]}` → `[]`, Pitfall 7) as the empty/has-events signal. It opens the `replay(runId)` stream (the SAME-reducer instant-fill) ONLY when the probe reports events; an empty probe renders `"No events recorded."` and never opens a stream. No hook change; reuses the 03-01 `useRunEventsQuery` that already existed for exactly this read. Asserted by the empty-events test.
- **Files:** `web/src/features/flow/components/RunDetail.tsx`.
- **Commit:** `5261937`.

**2. [Cross-plan cleanup, plan-directed] Removed the 03-04 RunTrigger navigate cast.**
- **Found during:** Task 2 — after registering `runDetailRoute`.
- **Issue:** 03-04 left a documented `navigate({ to } as Parameters<typeof navigate>[0])` cast in `RunTrigger.tsx` because the typed run sub-route did not exist yet. The plan's prior-context + `files_modified` both include `RunTrigger.tsx` and direct this cleanup.
- **Fix:** Replaced the built-path-string + cast with the typed `navigate({ to: '/flows/$flowId/runs/$runId', params: { flowId, runId } })` and removed the workaround comment; strict `tsc -b` confirms the route is now in the typed tree (it caught the original issue in 03-04). The RunTrigger X-Run-ID nav test still passes against the real route.
- **Files:** `web/src/features/flow/components/RunTrigger.tsx` (in `files_modified`).
- **Commit:** `5261937`.

No architectural changes (Rule 4), no auth gates, no package installs (T-03-SC: reused existing components/primitives/queries).

## Known Stubs
None. RunsHistory + the run sub-route are fully wired against the real `/api/flow/*` client + the Plan-03 reducer/hook + the Plan-04 components. The Slice-A Runs-tab placeholder and the 03-04 run-trigger placeholder are both now filled. The only Phase-bounded item is continuous mid-run live FOLLOW after a fresh deep-link (a running run shows the events-so-far via replay; continuous reconnect/follow is the Phase-5 reconnect concern noted in STATE), not a stub in this plan's scope.

## Threat Flags
None. No new security surface beyond the plan's threat register: replayed + live payloads render as React TEXT / escaped raw-JSON via the SAME TimelineView/RawJsonViewer (T-03-V5, asserted with markup-bearing run id + error); both the replay and any `/events` hydrate feed the (kind,node,ordinal)-de-duping reducer (T-03-07, exercised by the instant-fill + de-dup-safe running tail); empty `/events` → empty state not error (T-03-11, asserted); the run-history + run-detail reads send NO Authorization / NO X-Console-* (the 03-01 client omits them; BFF injects); no package installs (T-03-SC).

## Deferred / Manual-Only Verifications
- **MANUAL GATE (closes Phase-1 BFF-03 Part 2 — 03-VALIDATION "Manual-Only"; now observable AT this sub-route):** with the compose stack up (flowd + BFF + fronting nginx), trigger a streamed run and confirm frames render INCREMENTALLY (not batched) at `/flows/{id}/runs/{runId}` and idle-survival across a slow node (raised `proxy_read_timeout`); document the required LB idle-timeout for Phase 6. Requires a running flowd + proxy — cannot be unit-verified.
- **A1 (base64 / replay byte-identity against a live flowd):** the replay==live render parity is unit-proven via the golden sequence through the SAME reducer; the empirical confirmation that `/replay` re-streams byte-identical persisted frames still needs one live run (03-VALIDATION Manual-Only). Low risk — the reducer/de-dup are unit-tested in Plan 03.

## Verify Results
- `npx vitest run src/features/flow/components/RunsHistory.test.tsx` — **5 passed** (Task 1 gate).
- `npx vitest run src/features/flow/components/RunDetail.test.tsx` — **7 passed** (Task 2 gate).
- `npx vitest run src/features/flow` — **118 passed** (flow subtree).
- `npx vitest run` — **228 passed (28 files)**; 216 baseline preserved + 12 new (5 RunsHistory + 7 RunDetail). No regressions.
- `npx tsc --noEmit` — clean (exit 0).
- `npm run build` (`tsc -b` stricter + `vite build`) — clean; bundle built (pre-existing chunk-size advisory only — not an error). The strict build confirms the run sub-route is in the typed route tree (cast removed).
- `npm run lint` — **0 errors** (6 react-compiler `useReactTable` warnings: the 5 pre-existing in ResultsTable/FlowsTable/button + 1 new in RunsHistory, matching the established accepted table pattern — advisory, not errors).
- node_modules NOT committed; orchestrator's untracked `.planning/memory-inversion/` + `.gitignore` change left untouched.

**Called-out outcomes:**
- **Sub-route = single live+replay render location (D-08):** RunDetail mounts the Plan-04 TimelineView/NodeStatusList/ConnectionBadge/RunResultPanel fed by useRunStream and branches on `getRun` status — TERMINAL → `replay(runId)` (`data-mode="replay"`), RUNNING → live tail (`data-mode="live"`, ConnectionBadge **Streaming**). The golden sequence renders identically through the SAME reducer either way — green.
- **Instant-fill replay (de-dup):** a terminal run folds all four golden frames at once (no playback) into the SAME timeline; the (kind,node,ordinal) de-dup (Plan 03) keeps a hydrate-then-replay idempotent — green.
- **Empty events:** 200 `{events:[]}` → `"No events recorded."` empty state, NOT an error, no timeline opened — green.
- **Cast removal:** the 03-04 `navigate(... as ...)` cast is gone; the typed `navigate({ to: '/flows/$flowId/runs/$runId', params })` compiles under strict `tsc -b` — green.

## Self-Check: PASSED
All 5 created + 4 modified files present on disk; both task commits (`d34f1da`, `5261937`) in git history. Full suite 228 green; tsc/build/lint clean (0 errors); node_modules not committed.

---
*Phase: 03-flow-console*
*Completed: 2026-06-04*
