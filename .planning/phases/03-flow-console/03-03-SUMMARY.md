---
phase: 03-flow-console
plan: 03
subsystem: flow-timeline
tags: [flow, sse, reducer, dedup, connection-state-machine, hook, tdd, vitest]

# Dependency graph
requires:
  - phase: 03-flow-console
    plan: 01
    provides: "runStream/replayStream (X-Run-ID→onRunId), listRunEvents, the 6-kind SSE schemas (SseKind/SsePayload/RunEvent), and the makeFakeSseStream + golden fixtures the timeline tests consume"
provides:
  - "Pure timelineReducer: 6 SSE kinds → ordered append-only events + per-node status (pending/running/done/skipped/errored) + terminal (none/done/error) + captured outputs/error"
  - "(kind,node,ordinal) de-dup with per-SOURCE occurrence counters (live & history each count from 1) so the same logical event collides across sources — history+live overlap appears once; /events hydrate after a live prefix is idempotent (D-09); replay == live (success criterion 5)"
  - "connReducer connection-state machine: idle→streaming→closed|errored as a typed union, extensible for Phase-5 reconnecting; terminal-then-error guard"
  - "useRunStream imperative hook: start/replay/retry over runStream/replayStream + listRunEvents; X-Run-ID→runId+onRunId (D-08); terminal & unmount abort; retry() hydrates /events on a known run (NOT a re-POST)"
affects: [03-04 TimelineView + RunTrigger wiring, 03-05 run history + replay routes, 04-chat-console SSE timeline reuse]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure (state,action)→state timeline reducer is the SINGLE render-model code path for both live and replay (success criterion 5 by construction)"
    - "De-dup uses per-source occurrence ordinals (live/history each from 1), NOT the server seq — seq only proves ordering since SSE frames carry no seq/id/ts (Pitfall 2)"
    - "Connection state is a typed union (not a boolean) so Phase-5 'reconnecting' is a purely additive change (D-02)"
    - "useRunStream is the only side-effecting unit: it wraps the two pure machines + the 03-01 stream/REST seams; tests mock the wrapper + listRunEvents, never the network"
    - "retry() on a created run hydrates GET /events as history + reducer de-dup — never re-POSTs /run/stream (which would start a new run) (D-09/IC-6)"

key-files:
  created:
    - web/src/features/flow/timeline/reducer.ts
    - web/src/features/flow/timeline/reducer.test.ts
    - web/src/features/flow/timeline/connection.ts
    - web/src/features/flow/timeline/connection.test.ts
    - web/src/features/flow/timeline/useRunStream.ts
    - web/src/features/flow/timeline/useRunStream.test.ts
  modified: []

key-decisions:
  - "03-03: de-dup ordinal = per-SOURCE (kind,node) occurrence index (live & history each from 1), NOT the RunEvent seq — seq is global-across-kinds and absent from SSE frames; per-source counting is what makes history+live overlap collide to one event and replay==live"
  - "03-03: connection state is transport-only (closed on ANY terminal frame); run success vs failure is the timeline's terminal (done/error), not the connection's — keeps the union minimal + Phase-5 reconnect additive"
  - "03-03: terminal frame AND unmount both abort the AbortController (Pitfall 6 / T-03-06) so flowd's r.Context() cancels and no run leaks"
  - "03-03: retry() branches on a known runId — hydrate /events as history (de-dup idempotent) vs re-open runStream when the run was never created; it NEVER blindly re-POSTs /run/stream for a created run (D-09/IC-6)"

requirements-completed: [FLOW-04, FLOW-05, FLOW-06]

# Metrics
duration: 7min
completed: 2026-06-04
---

# Phase 3 Plan 03: Keystone Timeline Units (TDD) Summary

**The keystone streaming logic built TDD as small pure units provable WITHOUT a live flowd: a pure `timelineReducer` (6 SSE kinds → events + per-node status + terminal) with per-source `(kind,node,ordinal)` de-dup (history+live overlap once, replay==live), a typed connection-state machine, and the imperative `useRunStream` hook (X-Run-ID→runId, terminal+unmount abort, and a `retry()` that hydrates `/events` instead of re-POSTing a new run).**

## Performance
- **Duration:** ~7 min
- **Started:** 2026-06-04T02:53Z
- **Completed:** 2026-06-04T03:00Z
- **Features:** 3 (each RED→GREEN)
- **Files:** 6 created (3 impl + 3 tests)

## Accomplishments
- **Pure `timelineReducer`** folds the 6-kind frame log into the render model: ordered append-only `events`, a per-node `nodeStatus` map (pending→running→done/skipped/errored), `terminal` (none/done/error), and captured `outputs` (flow_done) / `error` (flow_err). No I/O, no React — fully unit-testable.
- **`(kind,node,ordinal)` de-dup (the single most important new piece):** because SSE frames carry no `seq`/`id`/`ts` (Pitfall 2), identity is `${kind}:${node}:${ordinal}` where the ordinal is the **per-source** occurrence index (live and history each count from 1). This is what makes the keystone fixture hold — history `[1,2,3]` + live tail `[3,4,5]` → `[1,2,3,4,5]` with the overlap once — and makes the D-09 `/events`-hydrate-after-a-live-prefix idempotent, and makes **replay render identically to live** (success criterion 5).
- **Connection-state machine (`connReducer`)** as a typed union `idle|streaming|closed|errored` (deliberately not a boolean): terminal frame → closed (it wins over a prior error), transport-error → errored unless already cleanly closed (terminal-then-error guard, Pitfall 6), reset → idle. Designed so Phase-5 `reconnecting` slots in additively (D-02).
- **`useRunStream` imperative hook** over the 03-01 stream/REST seams: `start` opens `runStream`, resets the reducer, sets conn streaming, folds frames in order; flowd's `X-Run-ID` surfaces via `runIdRef` + state + `opts.onRunId` for the deep-linkable sub-route (D-08); a terminal frame flips conn closed + aborts the fetch (Pitfall 6 / T-03-06); a transport drop before terminal → errored; `replay(runId)` feeds the SAME reducer as history; **`retry()` on a known runId hydrates `listRunEvents` as history (de-dup makes it idempotent) — it does NOT re-POST `/run/stream`** (D-09/IC-6), while an unknown runId re-opens `runStream`; unmount aborts.

## Task Commits
TDD RED→GREEN per feature (atomic):

1. **Reducer + de-dup** — RED `46035ef` (test) → GREEN `892a917` (impl)
2. **Connection-state machine** — RED `f1adcd8` (test) → GREEN `f218716` (impl)
3. **useRunStream hook** — RED `9bc4248` (test) → GREEN `3a26afd` (impl)

**Plan metadata:** _(this commit)_ (docs: complete plan)

## Files Created
- `web/src/features/flow/timeline/reducer.ts` — pure `timelineReducer` + `initialTimeline` + types (`Timeline`, `TimelineEvent`, `NodeStatus`, `Terminal`, `TimelineAction`); per-source ordinal de-dup.
- `web/src/features/flow/timeline/reducer.test.ts` — 14 cases: success/failure/node_skipped folding, the de-dup overlap fixture, D-09 hydrate idempotency, replay parity, reset.
- `web/src/features/flow/timeline/connection.ts` — `connReducer` + `initialConn` + `ConnState`/`ConnEvent` types.
- `web/src/features/flow/timeline/connection.test.ts` — 8 cases incl. the terminal-then-error guard + extensibility note.
- `web/src/features/flow/timeline/useRunStream.ts` — the imperative hook returning `{ timeline, conn, runId, start, replay, retry }`.
- `web/src/features/flow/timeline/useRunStream.test.ts` — 9 cases (mocks the stream wrappers + `listRunEvents`, not the network): in-order dispatch, X-Run-ID surfacing, terminal+unmount abort, transport-error→errored, retry()=/events hydrate-and-de-dup vs unknown-runId re-open, replay-as-history.

## Verify Results
- `npx vitest run` — **186 passed (22 files)**; 155 baseline preserved + 31 new (14 reducer + 8 connection + 9 hook). No regressions.
- `npx tsc --noEmit` — clean (exit 0).
- `npm run build` (`tsc -b` stricter + `vite build`) — clean; bundle built. (Pre-existing chunk-size advisory only — not an error.)
- `npm run lint` — **0 errors** (3 pre-existing warnings in `button.tsx` + `ResultsTable.tsx`, both outside 03-03 scope).

**Keystone test outcomes called out:**
- **De-dup:** history `[1,2,3]` + live tail `[3,4,5]` → `[1,2,3,4,5]` with exactly ONE `node_finished(upper)` — green.
- **Replay == live:** the same golden frames as `source:'history'` produce an identical render model (events/nodeStatus/terminal/outputs) to `source:'live'` — green.
- **retry()-hydrate:** on a known runId, `retry()` calls `listRunEvents('run_77')` (NOT a fresh `runStream`) and the re-sent prefix de-dups (no doubled events) — green; the unknown-runId branch re-opens `runStream` instead — green.

## Deviations from Plan
**1. [Rule 1 - Bug] De-dup ordinal source corrected from raw `seq` to a per-source occurrence index.**
- **Found during:** Feature 1 GREEN (the de-dup overlap + idempotency tests failed).
- **Issue:** The plan's `<implementation>` sketch suggested "ordinal = the carried `seq` if present (history) else append-position (live)". Mixing the two sources of ordinal makes the SAME logical event get DIFFERENT keys across live vs history (history `seq` is global-across-kinds: `node_finished`=3; the live append-position is 1), so the keystone overlap never de-duped (events doubled).
- **Fix:** The ordinal is now the **per-source** `(kind,node)` occurrence index — live and history each count from 1 — so the same logical event yields the IDENTICAL `${kind}:${node}:${ordinal}` from either source and de-dups. The server `seq` is still accepted on the action (callers pass it from RunEvent) but is intentionally NOT used as the ordinal; it only proves history is a clean prefix of live (Pitfall 2). This satisfies the plan's must-have truth ("history[1,2,3]+live[3,4,5] merges to [1,2,3,4,5] with no doubled overlap") and replay parity.
- **Files:** `web/src/features/flow/timeline/reducer.ts`.
- **Commit:** `892a917`.

**2. [Rule 1 - Test correctness] Rewrote one de-dup test to the real D-09 scenario.**
- **Found during:** Feature 1 GREEN.
- **Issue:** My initial RED test asserted "re-feeding the identical full live stream onto itself is idempotent" — that is not a real flowd scenario (live frames arrive once) and is incompatible with any positional ordinal scheme where a continuing live stream keeps counting.
- **Fix:** Replaced it with the genuine D-09/IC-6 case it was standing in for: a live prefix already rendered, then a `GET /events` history re-hydrate of that same prefix must de-dup (nothing doubles). This is the actual transport-drop-recovery invariant the hook relies on.
- **Files:** `web/src/features/flow/timeline/reducer.test.ts`.
- **Commit:** `892a917`.

No other deviations. No architectural changes (Rule 4), no auth gates, no package installs.

## Known Stubs
None. All three units are fully implemented and unit-tested. The renderer (`TimelineView`), the Run trigger wiring, and the run sub-route are intentionally OUT of scope (plans 03-04/03-05) — this plan delivers only the engine.

## Threat Flags
None. The reducer stores payloads as data only (no markup/eval — T-03-V5); terminal+unmount both abort (T-03-06); de-dup is unit-tested against the overlap fixture (T-03-07); X-Run-ID is surfaced as a plain string for a local route param only (T-03-12); no package installs (T-03-SC). No new security surface beyond the plan's threat register.

## Self-Check: PASSED
All 6 artifacts exist on disk; all 6 task commits (`46035ef`, `892a917`, `f1adcd8`, `f218716`, `9bc4248`, `3a26afd`) present in git history. Full suite 186 tests green; tsc/build/lint clean.

---
*Phase: 03-flow-console*
*Completed: 2026-06-04*
