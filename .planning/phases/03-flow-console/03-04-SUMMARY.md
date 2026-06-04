---
phase: 03-flow-console
plan: 04
subsystem: flow-ui
tags: [flow, sse, timeline, run-trigger, connection-badge, d-09, auto-scroll, navigate, vitest]

# Dependency graph
requires:
  - phase: 03-flow-console
    plan: 03
    provides: "useRunStream (start/replay/retry, X-Run-ID→onRunId, terminal/unmount abort) + the pure timelineReducer render model (events/nodeStatus/terminal/outputs/error) + the connection-state machine union"
  - phase: 03-flow-console
    plan: 02
    provides: "FlowDetailPage Definition-tab run-trigger slot + the three flow routes + the TanStack Router useNavigate pattern + flowKeys"
  - phase: 03-flow-console
    plan: 01
    provides: "runSync (POST /run), runStream/replayStream, parseFlowdError, the flowd fetch mock + runSyncResponse/error fixtures"
  - phase: 01-foundation
    provides: "RawJsonViewer (collapsed-by-default), Badge, ScrollArea, Input/Label/Button, sonner toast, --status-* tokens"
provides:
  - "TimelineView — append-only frame log over the Plan-03 reducer model: per-frame-kind icon/color (table a), collapsed per-frame raw-JSON, the ConnectionBadge header, auto-scroll-pause + Jump-to-latest (D-03), and the D-09 distinction (red flow_err in-body vs amber Connection-lost header + Retry→onRetry)"
  - "NodeStatusList — per-node status strip (pending/running/done/skipped/errored, table b) from the same reducer nodeStatus, color+icon+mono-name"
  - "ConnectionBadge — streaming(green)/closed(neutral)/errored(amber 'Connection lost') per UI-SPEC table c; idle renders nothing"
  - "RunResultPanel — the ONE result surface (D-04): sync outputs via raw-JSON, error string red, in-flight loader; shared with the sub-route's flow_done outputs (Plan 05)"
  - "useSyncRun — runSync mutation with Run started/complete/failed toasts (verbatim flowd message) + flowKeys.runs invalidation"
  - "RunTrigger — inputs string→string form; primary streamed Run → useRunStream.start({onRunId}) → navigate /flows/{id}/runs/{runId} on X-Run-ID (D-08); secondary Run (sync) → useSyncRun → RunResultPanel; mounted in the Definition tab"
affects: [03-05 run history + run sub-route (mounts TimelineView/RunResultPanel for live+replay), 04-chat-console SSE timeline reuse]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "The live render components (TimelineView/NodeStatusList/ConnectionBadge/RunResultPanel) are BUILT here but MOUNTED at the run sub-route in Plan 05 — the Definition tab hosts only RunTrigger + the sync RunResultPanel (D-08: single live+replay render location)"
    - "D-09 is encoded as color+location: red flow_err in the timeline BODY (a result; no Retry) vs amber 'Connection lost' in the HEADER (recoverable; Retry→hook.retry()=/events-hydrate). Asserted distinct in TimelineView.test"
    - "Auto-scroll-pause asserts INTENT not pixels (jsdom has no layout): scrollIntoView is stubbed; following fires when at-bottom + live, is skipped after a simulated manual scroll-up and in replay mode, and resumes on Jump-to-latest"
    - "The streamed Run navigates to the run sub-route via a BUILT path string (the typed route is owned by Plan 05) — a single documented cast seam, removed once that route is registered; the run id is a local route param only (T-03-12)"
    - "All flowd payload strings (node names, outputs, error, payloads) render as React TEXT nodes / raw-JSON viewer — never dangerouslySetInnerHTML (T-03-V5), asserted with a markup-bearing payload"

key-files:
  created:
    - web/src/features/flow/components/TimelineView.tsx
    - web/src/features/flow/components/TimelineView.test.tsx
    - web/src/features/flow/components/NodeStatusList.tsx
    - web/src/features/flow/components/ConnectionBadge.tsx
    - web/src/features/flow/components/RunResultPanel.tsx
    - web/src/features/flow/components/RunTrigger.tsx
    - web/src/features/flow/components/RunTrigger.test.tsx
    - web/src/features/flow/hooks/useSyncRun.ts
  modified:
    - web/src/features/flow/FlowDetailPage.tsx

key-decisions:
  - "03-04: TimelineView/NodeStatusList/ConnectionBadge/RunResultPanel are built here but the Definition tab mounts ONLY RunTrigger (+ the sync RunResultPanel); the live timeline renders at the run sub-route (Plan 05) — D-08 single render location"
  - "03-04: D-09 distinction is color+location: red flow_err in-body (result, no Retry) vs amber Connection-lost header + Retry→onRetry (the parent wires onRetry to the hook's retry()=/events-hydrate, never a fresh /run/stream)"
  - "03-04: auto-scroll follows via the bottom-sentinel's scrollIntoView; manual scroll-up (geometry: not at bottom) pauses + shows the accent Jump-to-latest pill; replay mode disables following (instant fill)"
  - "03-04: the streamed Run navigates to /flows/{id}/runs/{runId} via a BUILT path string + a single documented navigate cast (the typed route is registered by Plan 05); run id encoded as a local param only (T-03-12)"
  - "03-04: useSyncRun toasts Run started (mutationFn) / Run complete (onSuccess) / Run failed — {status}: {verbatim flowd msg} (onError) and invalidates flowKeys.runs so Slice C history refreshes"

requirements-completed: [FLOW-03, FLOW-04]

# Metrics
duration: 7min
completed: 2026-06-04
---

# Phase 3 Plan 04: Live Timeline UI (Slice B) Summary

**The live-run render surface built on the Plan-03 reducer/hook: a `TimelineView` (append-only per-frame log with per-frame-kind icons/colors, collapsed raw-JSON, a connection badge, auto-scroll-that-pauses + Jump-to-latest, and the operator-critical D-09 distinction — red `flow_err` in-body vs amber 'Connection lost' header + Retry→/events-hydrate), a `NodeStatusList` strip, a `ConnectionBadge`, a shared `RunResultPanel` (the ONE result surface), and a `RunTrigger` whose primary streamed Run navigates to `/flows/{id}/runs/{runId}` on X-Run-ID (D-08) while the secondary sync Run renders its outputs into the same panel (D-04). The Definition tab mounts only the trigger + sync result; the live timeline renders at the run sub-route in Plan 05.**

## Performance
- **Duration:** ~7 min
- **Started:** 2026-06-04T03:19Z
- **Completed:** 2026-06-04T03:26Z
- **Tasks:** 2
- **Files:** 9 (8 created, 1 modified)

## Accomplishments

### Task 1 — TimelineView + NodeStatusList + ConnectionBadge (commit `728aaab`)
- **TimelineView** renders the Plan-03 `timeline.events` as an append-only log: each row is a gutter status icon+color per the per-frame-kind table (a) — `flow_started` neutral slate (recommended over blue), `node_started` muted (spins while it is the live tail), `node_finished`/`flow_done` green, `node_skipped` muted, `flow_err` red — plus the sans frame-kind label, the mono node name when present, and a collapsed `RawJsonViewer` over the payload, connected by a 1px neutral rail. The header carries the `ConnectionBadge`.
- **D-09 distinction (the operator-critical contract):** a `flow_err` renders a RED terminal frame IN the body ("Flow failed — {error}." mono) with the partial timeline above it kept visible and NO Retry (re-running is a fresh Run). A transport drop (`conn==='errored'`, no terminal) shows the AMBER "Connection lost" header badge + a muted reconnect line + a Retry button calling the passed `onRetry` (the parent wires it to the hook's `retry()` = `/events` hydrate for the known runId, de-duped — never a fresh `/run/stream`).
- **Auto-scroll-pause (D-03):** while live + at-bottom, the bottom sentinel `scrollIntoView` follows each new frame; a manual scroll-up (geometry: not within 4px of bottom) sets `paused`, stops following, and shows the accent "Jump to latest" pill (bottom-center, present only while paused); clicking it scrolls to newest and resumes. `mode="replay"` disables following entirely (instant fill — Plan 05).
- **NodeStatusList** renders the per-node status strip from `timeline.nodeStatus` per table (b): each chip is color+icon+mono-node-name; running spins, skipped is muted at 0.6 opacity, errored is red.
- **ConnectionBadge** maps `ConnState` → table (c): streaming green (spinning), closed neutral, errored amber "Connection lost"; `idle` renders nothing.
- All flowd strings render as TEXT nodes / escaped raw-JSON (T-03-V5).
- **Tests (10):** frame rows + kind labels + mono node names; node-status chips with `data-status`; connection badge states; idle/empty copy; the D-09 pair (red in-body flow_err with no Retry + partial timeline; amber header + Retry→onRetry with no in-body failure); auto-scroll intent fires when not paused, is skipped after a simulated manual scroll-up and resumes on Jump-to-latest, and is skipped in replay mode; a markup-bearing payload renders escaped (no `<img>`).

### Task 2 — RunTrigger (streamed nav + sync) + RunResultPanel + useSyncRun (commit `ece19c6`)
- **useSyncRun** wraps the 03-01 `runSync` with the Phase-1 toast formula — "Run started." (mutationFn), "Run complete." (onSuccess), "Run failed — {status}: {verbatim flowd message}." + Copy-error (onError) — and invalidates `flowKeys.runs(flowId)` so Slice C's history refreshes after a sync run.
- **RunResultPanel** is the ONE result surface (D-04 / IC-4): sync `{outputs}` via the `RawJsonViewer`, the failure `{error}` string rendered red, and an in-flight loader. The same component is the surface the streamed run's terminal `flow_done` outputs render into at the sub-route (Plan 05).
- **RunTrigger** is an Inputs key/value form (string→string, flowd `map[string]string`) + the primary accent "Run" and secondary neutral "Run (sync)". The primary Run calls `useRunStream.start(flowId, inputs, { onRunId })` and, on the `X-Run-ID` callback, NAVIGATES to `/flows/{flowId}/runs/{runId}` (D-08) — the live TimelineView mounts there in Plan 05; the Definition tab does NOT mount it. "Run (sync)" calls `useSyncRun`; both buttons disable + the panel spins while a sync run is in flight (pessimistic).
- **FlowDetailPage** Definition tab now mounts `<RunTrigger flowId={flowId} />` in the slot Slice A left (replacing the placeholder); the Runs-tab history slot is untouched (Plan 05).
- **Tests (4):** primary Run calls `start(flowId, {}, {onRunId})` and the supplied `onRunId('run_live_42')` navigates to `/flows/echo_chain/runs/run_live_42` (the X-Run-ID nav, D-08); inputs collapse to a string→string map; the sync Run renders `{outputs}` in the RunResultPanel (and does NOT start the stream); a failed sync run renders the verbatim `{error}` red in the panel.

## Task Commits
1. **Task 1: TimelineView + NodeStatusList + ConnectionBadge with D-09** — `728aaab` (feat)
2. **Task 2: RunTrigger (streamed nav + sync) + RunResultPanel + useSyncRun** — `ece19c6` (feat)

**Plan metadata:** _(this commit)_ (docs: complete plan)

## Files Created/Modified
- `web/src/features/flow/components/TimelineView.tsx` — the keystone append-only renderer + auto-scroll-pause + D-09 in-body/header distinction + onRetry seam.
- `web/src/features/flow/components/TimelineView.test.tsx` — 10 cases (frames/strip/badge/idle/D-09 pair/auto-scroll intent×3/replay/XSS-escape).
- `web/src/features/flow/components/NodeStatusList.tsx` — per-node status strip from the reducer.
- `web/src/features/flow/components/ConnectionBadge.tsx` — streaming/closed/errored badge per table (c).
- `web/src/features/flow/components/RunResultPanel.tsx` — the ONE result surface (sync outputs/error/loader; shared with the sub-route).
- `web/src/features/flow/components/RunTrigger.tsx` — inputs form + streamed-Run-navigates + sync-Run; mounted in the Definition tab.
- `web/src/features/flow/components/RunTrigger.test.tsx` — 4 cases (X-Run-ID nav, string→string inputs, sync outputs, sync error).
- `web/src/features/flow/hooks/useSyncRun.ts` — the sync-run mutation + toasts + runs invalidation.
- `web/src/features/flow/FlowDetailPage.tsx` — **modified**: Definition tab mounts `RunTrigger` (replacing the run-trigger placeholder slot).

## Decisions Made
See `key-decisions` frontmatter. Headline: build-here / mount-at-sub-route (D-08); D-09 as color+location with the Retry wired to `retry()`/events-hydrate; auto-scroll asserted by intent; the streamed Run navigates via a built path string + one documented navigate cast (Plan 05 owns the typed route).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Streamed-Run navigation uses a built path string + a single documented navigate cast (the typed run sub-route is registered by Plan 05).**
- **Found during:** Task 2 `npm run build` (`tsc -b`, the strict project build over the generated route tree).
- **Issue:** `navigate({ to: '/flows/$flowId/runs/$runId', params: { flowId, runId } })` fails the strict build because `/flows/{id}/runs/{runId}` is NOT yet in the typed route tree — Plan 05 registers it. `npx tsc --noEmit` (looser config) did not catch this; `tsc -b` did. Per the plan, this slice MUST wire the navigate (the route is "consumed by 03-05") without registering the route.
- **Fix:** Navigate to the BUILT path string `/flows/${encodeURIComponent(flowId)}/runs/${encodeURIComponent(runId)}` via a single, documented `navigate({ to } as Parameters<typeof navigate>[0])` cast — the one seam where this plan reaches a route Plan 05 owns. The cast is removed once that route exists. The run id is encoded into the local path only — never markup, never an auth header (T-03-12). The X-Run-ID nav test confirms the path lands at `/flows/echo_chain/runs/run_live_42` against a sentinel sub-route.
- **Files:** `web/src/features/flow/components/RunTrigger.tsx`.
- **Commit:** `ece19c6`.

No other deviations. No architectural changes (Rule 4), no auth gates, no package installs (T-03-SC: reused existing primitives + the already-installed badge/scroll-area/input/label blocks).

## Known Stubs
None affecting this plan's goal. The live `TimelineView`/`NodeStatusList`/`ConnectionBadge`/`RunResultPanel` are fully implemented and unit-tested; they are deliberately NOT mounted in the Definition tab (D-08 — they mount at the run sub-route in Plan 05, after the streamed Run navigates there). The Definition-tab run surface (RunTrigger + sync RunResultPanel) is fully functional against the real `/api/flow/*` client + the Plan-03 hook. The Runs-tab run-history slot remains the Slice A placeholder (Plan 05).

## Threat Flags
None. No new security surface beyond the plan's threat register: payloads render as data/escaped raw-JSON (T-03-V5, asserted with a markup-bearing payload); RunTrigger/useSyncRun add no Authorization / X-Console-* (the 03-01 client omits them; BFF injects — T-03-08); the streamed run aborts on terminal+unmount via the Plan-03 hook (T-03-06); the X-Run-ID only builds a local, percent-encoded route param (T-03-12); no package installs (T-03-SC).

## Deferred / Manual-Only Verifications
- **MANUAL GATE (closes Phase-1 BFF-03 Part 2 — 03-VALIDATION "Manual-Only"):** with the compose stack up (flowd `New(cfg)` + BFF + fronting nginx), trigger a streamed run through the deployed stack and confirm frames render INCREMENTALLY (not batched) at the run sub-route and idle-survival across a slow node (raised `proxy_read_timeout`); document the required LB idle-timeout for Phase 6. This requires a running flowd + proxy and cannot be unit-verified — the live timeline mounts at the run sub-route in Plan 05, so this gate is most naturally exercised once 03-05 lands the sub-route route + summary.

## Verify Results
- `npx vitest run src/features/flow/components/TimelineView.test.tsx` — **10 passed** (Task 1 gate).
- `npx vitest run src/features/flow/components` — **30 passed** (4 files: TimelineView 10 + RunTrigger 4 + FlowsTable 6 + FlowEditor 10).
- `npx vitest run` — **216 passed (26 files)**; 202 baseline preserved + 14 new (10 TimelineView + 4 RunTrigger). No regressions.
- `npx tsc --noEmit` — clean (exit 0).
- `npm run build` (`tsc -b` stricter + `vite build`) — clean; bundle built (pre-existing chunk-size advisory only — not an error).
- `npm run lint` — **0 errors** (5 pre-existing react-compiler `useReactTable` warnings in `ResultsTable.tsx`/`button.tsx`, outside this plan's scope).
- node_modules NOT committed.

**Called-out outcomes:**
- **X-Run-ID nav (D-08):** the primary Run calls `start(flowId, {}, {onRunId})`; firing `onRunId('run_live_42')` navigates to `/flows/echo_chain/runs/run_live_42` — green.
- **D-09 distinction:** `flow_err` renders the RED in-body "Flow failed — node \"fetch\" timed out." with the partial timeline above and NO Retry/no "Connection lost"; a transport drop (`conn==='errored'`, no terminal) renders the AMBER "Connection lost" header + Retry→onRetry with NO in-body failure — asserted distinct (color + location + recovery) — green.

## Self-Check: PASSED
All 9 files present on disk; both task commits (`728aaab`, `ece19c6`) in git history. Full suite 216 green; tsc/build/lint clean; node_modules not committed.

---
*Phase: 03-flow-console*
*Completed: 2026-06-04*
