---
phase: 05-health-hardening
verified: 2026-06-09T16:28:00Z
status: human_needed
score: 3/3
overrides_applied: 0
human_verification:
  - test: "Live health dots reflect real service state"
    expected: "With flowd/chat/memory-gateway running, each dot shows up; kill one service and its dot turns down/unknown within ~15s with a last-checked timestamp"
    why_human: "Requires the three real services running; Docker/compose not available in CI sandbox (documented in 05-VALIDATION.md Manual-Only)"
  - test: "Live stream transport drop → reconnect → resume (flow)"
    expected: "Trigger a streamed flow run; cut the connection mid-run; see 'Reconnecting (n/N)...' badge + muted subline; after resume the timeline contains each event exactly once (de-dup); exhaust the cap → 'Connection lost' + Retry button"
    why_human: "Requires a live flowd + an induced transport drop through nginx; no live backend in sandbox (documented in 05-VALIDATION.md Manual-Only)"
---

# Phase 5: Health & Hardening — Verification Report

**Phase Goal:** An operator always sees per-service health at a glance, and every streaming/error/disconnected surface across the console is hardened into explicit, recoverable states.
**Verified:** 2026-06-09T16:28:00Z
**Status:** PASS-WITH-CARRYFORWARD (automated checks PASS; 2 live-service legs deferred to Phase 6 deploy scope per 05-VALIDATION.md)
**Re-verification:** No — initial verification

---

## Gate Command Outputs (actual runs, 2026-06-09)

| Gate | Command | Result |
|------|---------|--------|
| Go health tests | `GOWORK=off go test ./internal/router/ -run Health -count=1` | PASS — 3/3 subtests (StatusMapping, NoLeak, UnreachableDown); 3.005s |
| Go full suite | `GOWORK=off go test ./...` | PASS — config/proxy/router packages; 4.008s |
| TS health tests | `cd web && npx vitest run src/features/health` | PASS — 5/5 tests |
| TS connection + backoff | `cd web && npx vitest run connection.test.ts backoff.test.ts` | PASS — 27/27 tests |
| TS reconnect integration | `cd web && npx vitest run useRunStream.reconnect.test.ts useChatStream.reconnect.test.ts` | PASS — 12/12 tests |
| TS five-state + overlay | `cd web && npx vitest run FlowsPage.test.tsx ChatPage.reconnect.test.tsx` | PASS — 8/8 tests |
| TS full suite | `cd web && npm run test` | PASS — 308/308 tests, 38 files |
| TypeScript typecheck | `cd web && npm run typecheck` | PASS — 0 errors |
| ESLint | `cd web && npm run lint` | PASS — 0 errors, 6 warnings (pre-existing react-refresh/incompatible-library on TanStack Table and shadcn ui components, not introduced by Phase 5) |
| Build | `cd web && npm run build` | PASS — 726.55 kB bundle, 0 errors |

---

## Goal Achievement

### Observable Truths

| # | Truth (from ROADMAP.md Success Criteria) | Status | Evidence |
|---|------------------------------------------|--------|----------|
| 1 | Operator sees always-visible per-service health (up/down/degraded) for memory-gateway, flowd, and chat, polled on an interval with a last-checked timestamp | CODE-VERIFIED | `GET /api/health` handler exists in `internal/router/health.go` (parallel probes, leak-free DTO); mounted at `router.go:49`; `useServiceHealth.ts` polls at 15s; `TopBar.tsx` replaces static `status="unknown"` literals with `<LiveHealthDots />`; Go tests pass (StatusMapping/NoLeak/UnreachableDown); TS tests pass (5/5). Live-service visual confirmation is CARRIED-FORWARD (see Human Verification). |
| 2 | Each area enforces the UI-SPEC five-state contract (loading/empty/error/partial/ready), with stream views adding SSE-specific disconnected/reconnecting state on top — no ambiguous blank screens | CODE-VERIFIED | FlowsPage→FlowsTable→FiveStateWrapper (confirmed); RunDetailPage→RunDetail→FiveStateWrapper (confirmed); ChatPage inline equivalents (EmptyConversation/Thinking.../Failed/conn=errored) confirmed; FlowsPage.test.tsx 4/4 proves loading/empty/error/ready; ChatPage.reconnect.test.tsx 4/4 proves reconnecting overlay + four-signal distinction; ConnectionBadge has `reconnecting` arm (amber spinner + n/N counter). |
| 3 | Stream views show connection status with manual retry, and the client applies reconnect backoff with a cap and closes on the terminal `done` event (no reconnect storms) | CODE-VERIFIED | `backoff.ts` exports pure `nextDelay` + `DEFAULT_BACKOFF` (base 1s, factor 2, max 30s, cap 5); `connection.ts` extended with `reconnecting` state: `terminal` always wins (no storms), `reconnect-give-up` is the only path to `errored`; `useRunStream.ts` wires capped backoff loop → `retry()/listRunEvents` de-dup; `useChatStream.ts` uses `handleChatDrop()` for manual-retry-only policy (no auto-reconnect, preventing chat answer duplication); 12/12 reconnect integration tests pass. Live transport-drop confirmation is CARRIED-FORWARD. |

**Score: 3/3 truths verified (CODE-VERIFIED)**

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `internal/router/health.go` | healthAggregateHandler + parallel probeOne + serviceHealth DTO | VERIFIED | Exists; substantive (139 lines); wired at `router.go:49`; `func healthAggregateHandler` present |
| `internal/router/health_test.go` | httptest fake-upstream test: up/down/slow-degraded + no-URL/no-error-leak | VERIFIED | Exists; 162 lines; 3 subtests pass |
| `web/src/features/health/useServiceHealth.ts` | TanStack Query refetchInterval poll + stale-on-self-failure | VERIFIED | Exports `useServiceHealth`; refetchInterval 15s; stale-on-self-failure logic present; 5 TS tests pass |
| `web/src/components/shell/TopBar.tsx` | Live HealthDot status driven by useServiceHealth | VERIFIED | Imports `useServiceHealth`; `LiveHealthDots` component passes `.status` from `getService()` to each `<HealthDot>` |
| `web/src/features/flow/timeline/connection.ts` | ConnState union + 'reconnecting'; reconnect-success/give-up events + terminal-wins guard | VERIFIED | `reconnecting` in union; `reconnect-success`/`reconnect-give-up` events present; guard comments explicit |
| `web/src/features/flow/timeline/backoff.ts` | pure nextDelay + BackoffOpts + DEFAULT_BACKOFF | VERIFIED | Exports `nextDelay`, `DEFAULT_BACKOFF`; pure function, no timers |
| `web/src/features/flow/timeline/connection.test.ts` | reconnecting-transition tests | VERIFIED | 27/27 pass (connection + backoff combined) |
| `web/src/features/flow/timeline/backoff.test.ts` | deterministic sequence/cap/jitter-bound/reset tests | VERIFIED | 27/27 pass |
| `web/src/features/flow/timeline/useRunStream.ts` | auto-reconnect loop driving retry() on backoff timer + attempt/cap exposed | VERIFIED | Contains `nextDelay`, `scheduleReconnect`, `clearReconnect`, exposes `attempt` and `cap` |
| `web/src/features/flow/timeline/useRunStream.reconnect.test.ts` | drop→reconnecting(n/N)→resume-via-/events-dedup→terminal + cap→errored | VERIFIED | 7/7 pass |
| `web/src/features/chat/turns/useChatStream.ts` | manual-retry-only drop handling on BOTH seams + retry() re-open | VERIFIED | Contains `handleChatDrop`, dispatches `reconnect-give-up` synchronously; called from `onError` and `.catch` |
| `web/src/features/chat/turns/useChatStream.reconnect.test.ts` | chat drop → errored (BOTH seams); no auto re-open; manual retry re-opens | VERIFIED | 5/5 pass |
| `web/src/features/flow/components/ConnectionBadge.tsx` | reconnecting arm (amber spinner + (n/N) counter) | VERIFIED | `reconnecting` key in STATE_META; optional `attempt`/`cap` props; renders `Reconnecting (n/N)…` |
| `web/src/features/flow/components/TimelineView.tsx` | reconnecting overlay subline + attempt/cap forwarded to ConnectionBadge | VERIFIED | Contains `reconnecting`, `attempt`, `cap`; `data-slot="reconnecting-subline"` present |
| `web/src/features/flow/components/RunDetail.tsx` | threads useRunStream's attempt/cap → TimelineView | VERIFIED | Destructures `{ timeline, conn, attempt, cap }` from stream; passes `attempt={attempt} cap={cap}` to TimelineView |
| `web/src/features/chat/ChatPage.tsx` | reconnecting subline for symmetry + confirmed five-state coverage | VERIFIED | Contains `reconnecting-subline` data-slot; `EmptyConversation`, `Thinking…`, in-bubble Failed all present |
| `web/src/features/flow/FlowsPage.test.tsx` | loading/empty/error/ready (no blank panel) | VERIFIED | 4/4 pass |
| `web/src/features/chat/ChatPage.reconnect.test.tsx` | reconnecting overlay keeps partial visible; cap→Connection lost; signals distinct | VERIFIED | 4/4 pass |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `internal/router/router.go` | `healthAggregateHandler` | `mux.HandleFunc("GET /api/health", ...)` | WIRED | `router.go:49` confirmed |
| `web/src/components/shell/TopBar.tsx` | `/api/health` | `useServiceHealth → fetch('/api/health')` | WIRED | `TopBar.tsx` imports `useServiceHealth`; `useServiceHealth.ts` fetches `/api/health` |
| `web/src/features/flow/timeline/useRunStream.ts` | `retry() / listRunEvents` | `setTimeout(nextDelay(...)) → retry()` on fire | WIRED | `scheduleReconnect` uses `nextDelay`; fires `listRunEvents` |
| `web/src/features/flow/components/RunDetail.tsx` | `TimelineView.tsx` | destructure `{ attempt, cap }` from `useRunStream` → pass as TimelineView props | WIRED | `RunDetail.tsx:111` and `:206-207` confirmed |
| `web/src/features/flow/components/TimelineView.tsx` | `ConnectionBadge.tsx` | forward `attempt`/`cap` into `<ConnectionBadge attempt cap />` | WIRED | `TimelineView.tsx:193` confirmed |
| `web/src/features/flow/components/TimelineView.tsx` | `conn === 'reconnecting'` | transient overlay subline over partial timeline | WIRED | `data-slot="reconnecting-subline"` at `TimelineView.tsx:259` |
| `web/src/features/chat/ChatPage.tsx` | `conn === 'reconnecting'` | amber subline beneath partial trace | WIRED | `data-slot="reconnecting-subline"` at `ChatPage.tsx:255` |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `TopBar.tsx` → `LiveHealthDots` | `memory.status`, `flow.status`, `chat.status` | `useServiceHealth()` → `fetch('/api/health')` → `healthAggregateHandler` probing 3 real upstreams | Yes (real HTTP probes to configed upstream URLs; DTO status/lastChecked from live probe results) | FLOWING |
| `TimelineView.tsx` → `ConnectionBadge` | `conn`, `attempt`, `cap` | `useRunStream` state machine; `attempt` incremented by `scheduleReconnect` on transport drop | Yes (real state from live SSE connection events) | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Go health handler: flow→up, chat→down, memory→degraded | `GOWORK=off go test ./internal/router/ -run Health/StatusMapping` | PASS | PASS |
| Go health handler: no upstream URL or error field leaks | `GOWORK=off go test ./internal/router/ -run Health/NoLeak` | PASS | PASS |
| Go health handler: unreachable → all down, no host leak | `GOWORK=off go test ./internal/router/ -run Health/UnreachableDown` | PASS | PASS |
| TS: stale-on-self-failure (poll error → unknown + retained lastChecked) | `vitest run src/features/health` | 5/5 PASS | PASS |
| TS: reconnect machine (drop→reconnecting, success→streaming, give-up→errored, terminal-wins) | `vitest run connection.test.ts backoff.test.ts` | 27/27 PASS | PASS |
| TS: flow auto-reconnect with de-dup invariant + cap→errored | `vitest run useRunStream.reconnect.test.ts` | 7/7 PASS | PASS |
| TS: chat manual-retry-only from BOTH drop seams; no auto re-open | `vitest run useChatStream.reconnect.test.ts` | 5/5 PASS | PASS |
| TS: FlowsPage five-state (no blank panel in any state) | `vitest run FlowsPage.test.tsx` | 4/4 PASS | PASS |
| TS: four transport/result signals mutually distinct | `vitest run ChatPage.reconnect.test.tsx` | 4/4 PASS | PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SHELL-02 | 05-01, 05-02, 05-03, 05-04 | Always-visible per-service health + five-state/reconnect error hardening | SATISFIED | BFF `/api/health` + polling + live dots + `reconnecting` machine + five-state audit all verified |

---

## Anti-Patterns Found

| File | Pattern | Severity | Notes |
|------|---------|----------|-------|
| `ChatPage.tsx:32,189` | `"Thinking… placeholder"` in doc-comment and JSX comment | INFO | Not a stub — `Thinking…` is the deliberate "no-step-yet" loading state copy; file confirmed to have real streaming behavior above |

No TBD, FIXME, or XXX markers found in any Phase 5 modified file. No unreferenced debt markers. No empty implementations.

---

## Human Verification Required

### 1. Live health dots — real services

**Test:** Bring up the full compose stack (memory-gateway, flowd, customer-support chat). Load the console. Observe the three HealthDots in the TopBar.
**Expected:** Each dot shows `up` (green). Kill one service; within ~15s the corresponding dot flips to `down` (red) with the last-checked timestamp still visible. When the `/api/health` poll itself fails, all dots show `unknown` (slate) with a stale "Checked N ago — health check unavailable" tooltip.
**Why human:** Requires three real services running. Docker/compose is not available in the CI sandbox. Documented as Manual-Only in `05-VALIDATION.md`.

### 2. Live stream transport drop → reconnect → resume (flow)

**Test:** Trigger a streamed flow run. With the run in progress, forcibly drop the TCP connection through nginx (e.g., reload nginx or kill the upstream). Observe the ConnectionBadge and the timeline.
**Expected:** Badge flips to `Reconnecting (1/5)…` (amber, spinner). Timeline stays visible with already-arrived events. On reconnect the badge returns to `Streaming` (green) and new events append with no duplicates (de-dup verified). Exhaust 5 attempts → badge shows static `Connection lost` (amber, no spinner) + `Retry` button.
**Why human:** Requires a live flowd + induced transport drop through a real proxy. Cannot reproduce with the fake SSE emitter in CI. Documented as Manual-Only in `05-VALIDATION.md`.

---

## Verdict

**SC-1 (live health dots):** PASS-WITH-CARRYFORWARD
- Automated: BFF handler, parallel probes, leak-free DTO, 15s poll hook, stale-on-self-failure, live TopBar wiring — all CODE-VERIFIED with passing tests.
- Carried forward: live-service visual confirmation (flowd/chat/memory-gateway up/down/unknown behavior) — Phase 6 deploy scope.

**SC-2 (five-state + disconnected/reconnecting overlay):** PASS
- FiveStateWrapper conformance confirmed across FlowsPage, RunDetailPage (FiveStateWrapper), and ChatPage (inline equivalent states).
- Reconnecting overlay (badge + muted subline) wired on flow timeline (TimelineView) and chat (ChatPage).
- Four-signal distinction (green Streaming / amber-spinning Reconnecting(n/N) / amber-static Connection lost / red in-content Failed) proven by `ChatPage.reconnect.test.tsx`.

**SC-3 (reconnect backoff, cap, stop-on-terminal):** PASS-WITH-CARRYFORWARD
- Automated: `backoff.ts` pure scheduler, `connection.ts` machine guards (terminal always wins, give-up is the only errored path), `useRunStream` auto-reconnect loop with de-dup, `useChatStream` manual-retry-only from both drop seams — all CODE-VERIFIED.
- Carried forward: live transport-drop test through real proxy — Phase 6 deploy scope.

**Overall:** PASS-WITH-CARRYFORWARD. All three Success Criteria are CODE-VERIFIED with 308/308 TS tests passing, full Go suite passing, typecheck clean, lint 0 errors / 6 pre-existing warnings, and build clean. The two carried-forward items are live-service legs explicitly designated Manual-Only in `05-VALIDATION.md` and are Phase 6 deploy scope, not Phase 5 gaps.

---

*Verified: 2026-06-09T16:28:00Z*
*Verifier: Claude (gsd-verifier)*
