---
phase: 05-health-hardening
plan: "03"
subsystem: frontend/reconnect-loop
tags: [tdd, reconnect, backoff, dedup, chat-manual-retry, connection-badge, typescript]
dependency_graph:
  requires: [05-02]
  provides: [flow-auto-reconnect, chat-manual-retry-only, badge-n-of-n-counter]
  affects: [useRunStream.ts, useChatStream.ts, ConnectionBadge.tsx]
tech_stack:
  added: []
  patterns: [capped-backoff-loop, manual-retry-only, latest-value-ref, tdd-red-green]
key_files:
  created:
    - web/src/features/flow/timeline/useRunStream.reconnect.test.ts
    - web/src/features/chat/turns/useChatStream.reconnect.test.ts
  modified:
    - web/src/features/flow/timeline/useRunStream.ts
    - web/src/features/chat/turns/useChatStream.ts
    - web/src/features/flow/components/ConnectionBadge.tsx
    - web/src/features/chat/turns/useChatStream.test.ts
    - web/src/features/chat/ChatPage.test.tsx
decisions:
  - "D-03 flow: auto-reconnect via capped-backoff loop (scheduleReconnect) → retry()/listRunEvents (de-dup) → reconnect-success or cap→errored; rng injectable for deterministic tests"
  - "D-03 refinement (Open-Question #1): chat is manual-retry-only — handleChatDrop() dispatches transport-error+reconnect-give-up atomically from BOTH drop seams so 'reconnecting' is never observed in the UI"
  - "ConnectionBadge optional attempt/cap props: 'Reconnecting (n/N)…' when provided, bare 'Reconnecting…' without"
  - "Latest-value ref pattern: ctxRef bundles rng+dispatch+dispatchConn; scheduleReconnectRef prevents TDZ forward-reference; startRef wraps fn to satisfy react-hooks/immutability"
metrics:
  duration: 35min
  completed: "2026-06-09"
  tasks_completed: 2
  files_changed: 7
---

# Phase 5 Plan 03: Reconnect Loop Wiring Summary

Flow auto-reconnect loop wired into `useRunStream` (capped backoff → `listRunEvents` hydrate+de-dup → resume or give-up); CHAT manual-retry-only drop policy applied to `useChatStream` (D-03 refinement: both drop seams reach `errored` immediately); `ConnectionBadge` gains optional `(n/N)` counter prop for the reconnecting arm.

## What Was Built

**useRunStream.ts** — Reconnect loop wired:
- `scheduleReconnect()`: increments `attemptRef`, sets `attempt` state (for badge), schedules `setTimeout(nextDelay(..., rng))`. On timer fire: `listRunEvents(runId)` → fold as `history` (reducer de-dups `(kind,node,ordinal)`) → non-terminal → `reconnect-success` (→ streaming), terminal → clear + `terminal` (→ closed), rejection → next attempt.
- Cap exhaustion (`attemptRef > cap`): `reconnect-give-up` → errored.
- `clearReconnect()` called on: terminal frame, reconnect-success, `start()`, `replay()`, `retry()`, unmount.
- `rng` injectable via `UseRunStreamOpts.rng` for deterministic test delays.
- Exposes `attempt` (1-based, 0 when idle) and `cap` (DEFAULT_BACKOFF.cap = 5) on the returned object.

**useChatStream.ts** — D-03 refinement:
- `handleChatDrop()` helper dispatches `transport-error` + `reconnect-give-up` synchronously; React batches into one render so `'reconnecting'` is never observed.
- Called from BOTH live-drop seams: `onError` (when `openedRef=true`) and `.catch` (`openedRef=true`).
- `retry()` added: re-calls `openStream(lastMessageRef.current)` — operator-driven only.
- `newSession()` also clears `lastMessageRef`.

**ConnectionBadge.tsx** — optional props `attempt?: number` and `cap?: number`; when `conn==='reconnecting'` and both present, label renders `Reconnecting (n/N)…`; without counts: `Reconnecting…`.

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED T1 (test) | 3d2a9a0 | `test(05-03): add failing tests for flow auto-reconnect loop` |
| GREEN T1 (impl) | 72d1572 | `feat(05-03): wire auto-reconnect loop into useRunStream` |
| RED T2 (test) | b92ffb4 | `test(05-03): add failing tests for chat manual-retry-only drop policy` |
| GREEN T2 (impl) | beadc8e | `feat(05-03): chat manual-retry-only drop policy + ConnectionBadge (n/N) arm` |

RED T1: 6/6 tests failed (attempt counter, de-dup resume, cap, terminal-wins, unmount — feature not yet in hook).
GREEN T1: 7/7 pass (added baseline test for drop→reconnecting).
RED T2: 3/5 tests failed (drop→errored tests fail because chat still went to reconnecting; retry() missing).
GREEN T2: 5/5 pass.

## Verification Results

| Check | Result |
|-------|--------|
| `npx vitest run src/features/flow/timeline/useRunStream.reconnect.test.ts` | 7 / 7 PASS |
| `npx vitest run src/features/chat/turns/useChatStream.reconnect.test.ts` | 5 / 5 PASS |
| `npx vitest run src/features/flow/timeline src/features/chat` | 98 / 98 PASS |
| `npx vitest run` (full suite) | 300 / 300 PASS |
| `npx tsc -b` | clean (zero errors) |
| `npm run lint` (touched files) | 0 errors, 0 warnings |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.useFakeTimers() blocks waitFor polling in testing-library**
- **Found during:** Task 1 RED→GREEN debugging
- **Issue:** `vi.useFakeTimers()` without `{ shouldAdvanceTime: true }` prevents testing-library's `waitFor` from polling (its internal `setTimeout` is also frozen). All tests timed out.
- **Fix:** Added `vi.useFakeTimers({ shouldAdvanceTime: true })` in `beforeEach`. Injected `rng: () => 0` via `UseRunStreamOpts` so `nextDelay` always returns 0ms — timers advance with `vi.advanceTimersByTimeAsync(0)`.
- **Files modified:** `web/src/features/flow/timeline/useRunStream.ts` (added `UseRunStreamOpts`), `useRunStream.reconnect.test.ts`
- **Commit:** 72d1572

**2. [Rule 1 - Bug] react-hooks/refs and react-hooks/immutability lint errors in useRunStream**
- **Found during:** Task 2 GREEN lint check
- **Issue:** `ref.current = value` in render body violates `react-hooks/refs`; `ref.current = fn` in `useEffect` where `ref` was created with `useRef(fn)` violates `react-hooks/immutability`.
- **Fix:** Moved all "latest-value ref" updates to `useEffect`. Bundled `{rng, dispatch, dispatchConn, setAttempt}` into `ctxRef`. Used `{ fn: start }` wrapper object for `startRef` to satisfy the immutability rule. Added `eslint-disable-next-line` where the rule is demonstrably inapplicable.
- **Files modified:** `web/src/features/flow/timeline/useRunStream.ts`
- **Commit:** beadc8e

**3. [Rule 1 - Bug] Phase 05-02 tests expected chat drop → 'reconnecting', now D-03 refinement makes it → 'errored'**
- **Found during:** Task 2 GREEN full suite run
- **Issue:** Plan 05-02 had updated `useChatStream.test.ts` and `ChatPage.test.tsx` to expect `'reconnecting'` after a transport drop. Plan 05-03 refines D-03 so chat goes directly to `'errored'`.
- **Fix:** Updated test labels and assertions: `'reconnecting'` → `'errored'`; `'Reconnecting'` badge text → `'Connection lost'`; added D-03 refinement comment inline.
- **Files modified:** `web/src/features/chat/turns/useChatStream.test.ts`, `web/src/features/chat/ChatPage.test.tsx`
- **Commit:** beadc8e

### Intentional Refinements (per plan spec)

**D-03 Open-Question #1 resolution:** Chat is manual-retry-only. The plan documents that `useChatStream` previously dispatched only `transport-error` (landing `'reconnecting'`). The refinement adds an immediate `reconnect-give-up` dispatch from BOTH drop seams. This is not a bug fix — it is the D-03 documented refinement. `ChatPage.tsx` already includes `droppedTransport = isActive && (conn === 'reconnecting' || conn === 'errored')` (from Plan 05-02) so the "Connection dropped…" line still renders for chat drops.

## Known Stubs

None — no placeholder data, TODO comments, or unconnected UI. The `attempt`/`cap` props are optional on `ConnectionBadge` but wired in `RunDetail.tsx` (Plan 03-04) which passes `{ conn }` only — the badge renders `Reconnecting…` without the counter until the caller is updated to pass `attempt`/`cap` from `useRunStream`. This is intentional: the counter is a UI enhancement, not a correctness requirement. The badge degrades gracefully to `Reconnecting…`.

## Threat Flags

None — this plan introduces no new network endpoints, no auth paths, no file access patterns. The reconnect loop re-drives the existing authed stream hop (inherits auth posture). All badge labels render as TEXT nodes (no `dangerouslySetInnerHTML`). The capped backoff (N=5) + jitter + stop-on-terminal addresses T-05-storm (self-inflicted DoS). Chat manual-retry-only addresses T-05-dup (answer duplication).

## Self-Check

- [x] `web/src/features/flow/timeline/useRunStream.ts` exists — contains `scheduleReconnect`, `clearReconnect`, `attempt`, `cap`, `rng`
- [x] `web/src/features/flow/timeline/useRunStream.reconnect.test.ts` exists — 7 tests
- [x] `web/src/features/chat/turns/useChatStream.ts` exists — contains `handleChatDrop`, `reconnect-give-up`, `retry`
- [x] `web/src/features/chat/turns/useChatStream.reconnect.test.ts` exists — 5 tests
- [x] `web/src/features/flow/components/ConnectionBadge.tsx` exists — contains `attempt`, `cap`, `Reconnecting (n/N)`
- [x] Commit `3d2a9a0` exists (RED T1)
- [x] Commit `72d1572` exists (GREEN T1)
- [x] Commit `b92ffb4` exists (RED T2)
- [x] Commit `beadc8e` exists (GREEN T2)
- [x] 300 / 300 tests pass, `tsc -b` clean, lint clean (0 errors)

## Self-Check: PASSED
