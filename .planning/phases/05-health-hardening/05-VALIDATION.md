---
phase: 5
slug: health-hardening
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-04
---

# Phase 5 — Validation Strategy

> Per-phase validation contract. Source: `05-RESEARCH.md` §Validation Architecture (health endpoints + reconnect verified from source).
> Spans BOTH the Go BFF (`/api/health`, httptest) and the TS frontend (poll + reconnect, Vitest + fake SSE emitter). Go commands need `GOWORK=off`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (TS)** | Vitest 4.1.x + @testing-library/react |
| **Framework (Go)** | `go test` + `net/http/httptest` (`GOWORK=off`) |
| **Config file** | `web/vitest.config.ts` (present); Go standard `_test.go` |
| **Quick run** | `cd web && npx vitest run src/features/flow/timeline src/features/health` · `GOWORK=off go test ./internal/router/` |
| **Full suite** | `cd web && npx vitest run` · `GOWORK=off go test ./...` |

---

## Per-Task Verification Map

| Req/Dec | Slice | Behavior under test | Threat Ref | Test Type | Automated Command | File Exists | Status |
|---------|-------|---------------------|------------|-----------|-------------------|-------------|--------|
| SHELL-02/D-01 | A | `/api/health` probes 3 upstreams in parallel; up/down/degraded mapping; NO upstream URL/err leak in body | T-05-leak | Go unit (httptest) | `GOWORK=off go test ./internal/router/ -run Health` | ❌ W0 | ⬜ pending |
| SHELL-02/D-02 | A | HealthDot polls `/api/health` ~15s, shows status + last-checked + stale-on-self-failure (unknown) | — | TS component | `vitest run src/features/health` | ❌ W0 | ⬜ pending |
| D-03 | B | `connReducer` reconnecting transitions (drop→reconnecting→streaming; cap→errored; terminal `done` wins) | — | TS unit | `vitest run src/features/flow/timeline/connection.test.ts` | ✅ extend | ⬜ pending |
| D-03 | B | backoff scheduler: sequence, cap, jitter bound, reset (injected rng) | — | TS unit | `vitest run src/features/flow/timeline/backoff.test.ts` | ❌ W0 | ⬜ pending |
| D-03 | B | reconnect-resume preserves flow de-dup invariant (drop → reconnecting(n/N) → resume via /events hydrate) | — | TS integration (fake emitter) | `vitest run src/features/flow/timeline` | ❌ W0 | ⬜ pending |
| D-03 | B | cap-exhausted → errored "Connection lost" (flow + chat); chat reconnect policy (manual-retry vs auto) honored | — | TS integration | `vitest run src/features/chat src/features/flow` | ❌ W0 | ⬜ pending |
| D-04 | B | five-state conformance for FlowsPage/RunDetailPage/ChatPage (no blank panel) | T-V5 | TS component | `vitest run src/features` | ⚠️ audit | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `internal/router/health.go` + `internal/router/health_test.go` — `/api/health` handler (parallel probe + per-service timeout + up/down/degraded) + fake-upstream test (incl. a down service, a slow→degraded one, and the **no-upstream-URL/err-leak** assertion). Covers SHELL-02/D-01.
- [ ] `web/src/features/health/useServiceHealth.ts` + `health.test.ts` — TanStack Query `refetchInterval` poll + mocked `/api/health` + stale-on-error → unknown. Covers D-02.
- [ ] `web/src/features/flow/timeline/backoff.ts` + `backoff.test.ts` — PURE scheduler with injected `rng` (deterministic). Covers D-03.
- [ ] Extend `web/src/features/flow/timeline/connection.test.ts` — reconnecting transitions (+ the terminal-wins + cap→errored guard). Covers D-03.
- [ ] Reconnect-resume integration test reusing `web/src/test/mocks/fetch-event-source.ts` (`makeFakeSseStream` `.fail()`→`emitOpen()`). Covers the D-03 de-dup invariant.
- [ ] Five-state audit: confirm/fix `FlowsPage.tsx`, `RunDetailPage.tsx`, `ChatPage.tsx` (grep-verified: none import `FiveStateWrapper`). Add a component test where a gap is fixed.
- [ ] No framework install — Vitest + httptest already present. Go tests run `GOWORK=off`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live `/api/health` against the 3 real services | SHELL-02 | Needs running flowd/chat/memory-gateway; Docker unreachable in sandbox | Stack up: confirm each dot reflects real up/down; kill one service → its dot goes down within ~15s with last-checked |
| Live reconnect on a real mid-run transport drop | D-03 | Needs a live stream + an induced drop through nginx | Trigger a streamed flow run; drop the connection mid-run; confirm "Reconnecting (n/N)…" then resume via /events with no duplicated/lost events; exhaust the cap → "Connection lost" + manual Retry |

*The BFF handler, the poll logic, the backoff scheduler, the connection machine, and reconnect-resume-with-dedup are all automated above (httptest + fake emitter); only the live-service legs need the running stack.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 25s (Go + TS suites)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
