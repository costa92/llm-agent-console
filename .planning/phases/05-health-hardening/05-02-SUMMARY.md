---
phase: 05-health-hardening
plan: "02"
subsystem: frontend/connection-state
tags: [tdd, connection-state, backoff, reconnect, typescript]
dependency_graph:
  requires: [05-01]
  provides: [reconnecting-state, backoff-scheduler]
  affects: [connection.ts, ConnectionBadge.tsx, ChatPage.tsx]
tech_stack:
  added: []
  patterns: [pure-function, full-jitter-backoff, additive-state-extension]
key_files:
  created:
    - web/src/features/flow/timeline/backoff.ts
    - web/src/features/flow/timeline/backoff.test.ts
  modified:
    - web/src/features/flow/timeline/connection.ts
    - web/src/features/flow/timeline/connection.test.ts
    - web/src/features/flow/timeline/useRunStream.test.ts
    - web/src/features/flow/components/ConnectionBadge.tsx
    - web/src/features/chat/turns/useChatStream.test.ts
    - web/src/features/chat/ChatPage.tsx
    - web/src/features/chat/ChatPage.test.tsx
decisions:
  - "reconnecting is the only new ConnState arm; transport-error → reconnecting, reconnect-give-up → errored (only path)"
  - "droppedTransport in ChatPage includes reconnecting || errored so dropped-line renders immediately on drop"
  - "ConnectionBadge reconnecting arm shares amber token with errored but uses Loader spinner not Unplug"
metrics:
  duration: 6min
  completed: "2026-06-09"
  tasks_completed: 2
  files_changed: 9
---

# Phase 5 Plan 02: Reconnecting State + Pure Backoff Scheduler Summary

Additive extension of the Phase-3/4 `connection.ts` machine with a `reconnecting` state and a pure `backoff.ts` `nextDelay()` capped-exponential-backoff-with-jitter scheduler; both proven RED→GREEN with deterministic unit tests.

## What Was Built

**connection.ts** — `ConnState` union widened from 4 to 5 states (`'reconnecting'` inserted between `'streaming'` and `'errored'`). Two new events added: `reconnect-success` (→ streaming) and `reconnect-give-up` (→ errored). Guard changes:
- `transport-error` while `'streaming'` → `'reconnecting'` (was `'errored'`)
- `transport-error` while `'reconnecting'` → idempotent (loop owns give-up)
- `terminal` ALWAYS wins from any non-idle state → `'closed'` (no reconnect storms)
- `reconnect-give-up` is the **ONLY** path to `'errored'` (Pitfall 1 proven)

**backoff.ts** — pure `nextDelay(attempt, opts, rng)` with full-jitter formula `floor(rng() * min(maxMs, baseMs * factor^attempt))`. Zero timers, zero side effects. `DEFAULT_BACKOFF = {baseMs:1000, factor:2, maxMs:30_000, cap:5}` per UI-SPEC IC-2.

**ConnectionBadge.tsx** — `reconnecting` arm added: amber `--status-degraded` token, `Loader` spinner (same as `streaming`), label `'Reconnecting'`. Static `Unplug` remains for `errored` to distinguish "in progress" from "gave up".

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (test) | b9caa17 | `test(05-02): add failing tests for reconnecting state + backoff scheduler` |
| GREEN (impl) | 4f8a721 | `feat(05-02): extend connection.ts with reconnecting state + pure backoff.ts` |
| REFACTOR | — | Not needed |

RED confirmed: 4 connection tests + all backoff tests failed against the pre-extension code. GREEN: 288 tests pass, `tsc -b` clean.

## Verification Results

| Check | Result |
|-------|--------|
| `npx vitest run connection.test.ts backoff.test.ts` | 27 / 27 PASS |
| `npx vitest run src/features/flow/timeline` | 50 / 50 PASS (zero regression) |
| `npx vitest run` (full suite) | 288 / 288 PASS |
| `npx tsc -b` | clean (zero errors) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Phase 3/4 test expectation `transport-error → errored` now incorrect**
- **Found during:** GREEN — `npx vitest run src/features/flow/timeline` revealed 3 failures in `useRunStream.test.ts`
- **Issue:** Phase 3/4 tests asserted `conn === 'errored'` after `transport-error`, but Phase 5 machine now goes `'reconnecting'`
- **Fix:** Updated 3 `useRunStream.test.ts` assertions to `'reconnecting'`; updated `describe` labels with Phase 5 context
- **Files modified:** `web/src/features/flow/timeline/useRunStream.test.ts`
- **Commit:** 4f8a721

**2. [Rule 1 - Bug] `useChatStream.test.ts` same old-behavior assertion**
- **Found during:** GREEN — full suite run revealed `fail() → errored` test failing
- **Fix:** Updated `describe`/`it` label and assertion to `'reconnecting'`
- **Files modified:** `web/src/features/chat/turns/useChatStream.test.ts`
- **Commit:** 4f8a721

**3. [Rule 1 - Bug] `ChatPage.test.tsx` expected "Connection lost" badge text after drop**
- **Found during:** GREEN — `ChatPage.test.tsx` found `'Connection lost'` text missing; now badge shows `'Reconnecting'`
- **Fix:** Updated test to assert `'Reconnecting'` badge text; updated `describe`/`it` labels
- **Files modified:** `web/src/features/chat/ChatPage.test.tsx`
- **Commit:** 4f8a721

**4. [Rule 1 - Bug] `ChatPage.tsx` droppedTransport condition used `conn === 'errored'` only**
- **Found during:** GREEN — `ChatPage.test.tsx` asserted "Connection dropped…" line visible after drop, but `droppedTransport = isActive && conn === 'errored'` evaluated false (conn was `'reconnecting'`)
- **Fix:** `droppedTransport = isActive && (conn === 'reconnecting' || conn === 'errored')` — both transport-break states show the dropped line
- **Files modified:** `web/src/features/chat/ChatPage.tsx`
- **Commit:** 4f8a721

**5. [Rule 1 - Bug] `ConnectionBadge.tsx` `STATE_META` Record was missing `reconnecting` key**
- **Found during:** GREEN — TypeScript compiler: `Property 'reconnecting' is missing in type`
- **Fix:** Added `reconnecting` arm to `STATE_META`; extended spinner ternary from `streaming` to `streaming || reconnecting`
- **Files modified:** `web/src/features/flow/components/ConnectionBadge.tsx`
- **Commit:** 4f8a721

All 5 deviations are direct consequences of the plan's own `connection.ts` change — the `ConnState` union widening propagated to every consumer. No architectural changes required.

## Known Stubs

None — no placeholder data, TODO comments, or unconnected UI.

## Threat Flags

None — this plan adds no network endpoints, no auth paths, no file access patterns. The `reconnecting` state is a pure client-side state machine extension; no new threat surface.

## Self-Check

- [x] `web/src/features/flow/timeline/backoff.ts` exists
- [x] `web/src/features/flow/timeline/backoff.test.ts` exists
- [x] `web/src/features/flow/timeline/connection.ts` contains `reconnecting`
- [x] Commit `b9caa17` exists (RED)
- [x] Commit `4f8a721` exists (GREEN)
- [x] 288 / 288 tests pass, `tsc -b` clean

## Self-Check: PASSED
