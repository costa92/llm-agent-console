---
phase: 05-health-hardening
plan: "01"
subsystem: health
tags: [go-bff, tanstack-query, sse-health, security]
dependency_graph:
  requires: []
  provides: [/api/health BFF endpoint, useServiceHealth hook, live TopBar HealthDots]
  affects: [web/src/components/shell/TopBar.tsx]
tech_stack:
  added: []
  patterns:
    - Go parallel probe with goroutines+WaitGroup+sync.Mutex inside http.HandlerFunc closure
    - TanStack Query refetchInterval poll with stale-on-self-failure via q.data retention
key_files:
  created:
    - internal/router/health.go
    - internal/router/health_test.go
    - web/src/features/health/useServiceHealth.ts
    - web/src/features/health/health.test.ts
  modified:
    - internal/router/router.go
    - web/src/components/shell/TopBar.tsx
decisions:
  - "D-01: single BFF /api/health endpoint probes 3 upstreams in parallel — SPA polls only one URL"
  - "D-02: states up/down/degraded server-side; unknown client-only (pre-poll or poll-failure); stale lastChecked retained on error"
  - "T-05-leak: DTO carries only status/lastChecked/latencyMs — never upstream URL or err.Error()"
  - "memory /metrics probe: GET + io.Copy(io.Discard) — never parsed; HEAD would 405 under Go 1.22+ method-specific ServeMux"
  - "degradedAbove=1s with rationale that memory /metrics latency is noisier than a ping (OQ#2 resolution)"
metrics:
  duration: 9min
  completed: "2026-06-09"
  tasks: 2
  files: 6
---

# Phase 05 Plan 01: Health Aggregate Handler and Live Dots Summary

BFF `GET /api/health` endpoint with parallel probes returning a leak-free status DTO, plus TanStack Query poll hook and live TopBar HealthDots replacing `status="unknown"` literals.

## What Was Built

### Task 1 — BFF /api/health aggregate handler (Go, TDD RED→GREEN)

`internal/router/health.go` implements `healthAggregateHandler(cfg)` as a closure-over-config `http.HandlerFunc`. Key properties:

- **Parallel probes**: three goroutines (`sync.WaitGroup` + `sync.Mutex`-guarded results map) probe `{FlowBase}/healthz`, `{ChatBase}/healthz`, `{MemoryBase}/metrics` concurrently.
- **`probeOne`**: `context.WithTimeout(r.Context(), 3s)` per probe; `http.MethodGet`; on transport error returns `("down", -1)` without echoing `err.Error()`; drains body via `io.Copy(io.Discard)`; maps 2xx-fast→`up`, 2xx-slow(>1s)→`degraded`, non-2xx→`down`.
- **Security (T-05-leak)**: DTO carries only `{status, lastChecked, latencyMs?}` — never the probe URL or error string.
- **`unknown` never emitted**: server-only returns `up|down|degraded` (D-02; `unknown` is client-side-only).
- **Cache-Control: no-store** and **Content-Type: application/json** set on every response.

`internal/router/health_test.go` tests:
- `StatusMapping`: flow→`up`, chat→`down`, memory→`degraded`; parallel timing guard (`elapsed < 3×slowSleep`); `unknown` absent from body.
- `NoLeak`: upstream hosts not present in response body; no `"error"/"err"/"url"/"detail"` fields.
- `UnreachableDown`: connection error → `down` for all services, no host leak.

### Task 2 — Mount route + frontend poll + live TopBar

- **`internal/router/router.go`**: `mux.HandleFunc("GET /api/health", healthAggregateHandler(cfg))` added alongside `GET /api/config/env`, inside `MiddlewareOperatorAuth` wrap (V4/V9 — no allowlist widening).
- **`web/src/features/health/useServiceHealth.ts`**: `useQuery` with `refetchInterval: 15_000`, `refetchIntervalInBackground: false`, `refetchOnWindowFocus: true`. Stale-on-self-failure rule: `q.isPending` → `unknown`; `q.isError` → `unknown` + `lastChecked` from `q.data` (last success retained by TanStack Query); success → real status + `lastChecked`.
- **`web/src/features/health/health.test.ts`**: 5 tests covering success mapping, isPending→unknown, stale-on-self-failure with retained lastChecked, and error-with-no-prior-success. Key fix: `mockImplementation` (not `mockResolvedValue`) so each fetch call gets a fresh `Response` stream object.
- **`web/src/components/shell/TopBar.tsx`**: replaced three `<HealthDot status="unknown" />` literals with `<LiveHealthDots />` component driven by `useServiceHealth`. `formatLastChecked` produces relative timestamps ("Checked 8s ago") per UI-SPEC copywriting; on poll error appends "— health check unavailable".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TanStack Query Response stream reuse**
- **Found during:** Task 2 test development
- **Issue:** `fetchMock.mockResolvedValue(new Response(...))` returns the same `Response` instance on every call. `Response` bodies are one-shot streams — the second call to `res.json()` fails silently, causing the query to enter error state immediately after first success. This manifested as tests passing `waitFor` then finding `unknown` status on subsequent `getService` calls (re-render triggered a re-fetch that failed).
- **Fix:** Switched to `fetchMock.mockImplementation(() => Promise.resolve(new Response(...)))` so each fetch call creates a fresh Response.
- **Files modified:** `web/src/features/health/health.test.ts`
- **Commit:** ccaf3c5

**2. [Rule 2 - TypeScript] Test type annotations for vi.fn() and globalThis**
- **Found during:** Task 2 `npx tsc -b` check
- **Issue:** `vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()` used deprecated 2-arg generic; `global` is not in strict TS, should be `globalThis`.
- **Fix:** Changed to `vi.fn()` with `mockImplementation` cast `as typeof fetch`.
- **Files modified:** `web/src/features/health/health.test.ts`
- **Commit:** ccaf3c5

## TDD Gate Compliance

Plan has `tdd="true"` on Task 1. Gates satisfied:

1. **RED** — `test(05-01): add failing health aggregate handler tests (RED)` — commit b9133f6
2. **GREEN** — `feat(05-01): BFF /api/health aggregate handler with parallel probes (GREEN)` — commit 38b6bc0
3. **REFACTOR** — not needed (implementation was clean on first pass)

## Verification Results

- `GOWORK=off go test ./internal/router/ -run Health -count=1`: PASS (3 subtests, 3.0s due to slow probe)
- `GOWORK=off go test ./...`: PASS (all packages)
- `cd web && npx vitest run src/features/health`: PASS (5 tests)
- `cd web && npm run test`: PASS (269 tests across 33 files)
- `cd web && npx tsc -b`: clean
- `cd web && npm run build`: clean build

## Known Stubs

None — all health dot statuses are wired to live data from `/api/health`.

## Threat Flags

No new surface beyond plan's `<threat_model>`. All T-05-* mitigations verified:
- T-05-leak: proven by `NoLeak` subtest asserting no upstream host and no `"error"/"url"/"detail"` in response.
- T-05-ssrf: probe URLs fixed from config, no client input.
- T-05-metrics: body drained via `io.Copy(io.Discard)`, never parsed or forwarded.
- T-05-secret: health probes are auth-none; FlowdToken/OperatorToken not in any probe path.
- T-05-xss: all strings render as TEXT nodes in TopBar/HealthDot.

## Self-Check: PASSED

Created files:
- internal/router/health.go ✓
- internal/router/health_test.go ✓
- web/src/features/health/useServiceHealth.ts ✓
- web/src/features/health/health.test.ts ✓

Modified files:
- internal/router/router.go ✓
- web/src/components/shell/TopBar.tsx ✓

Commits:
- b9133f6 test(05-01): add failing health aggregate handler tests (RED) ✓
- 38b6bc0 feat(05-01): BFF /api/health aggregate handler with parallel probes (GREEN) ✓
- ccaf3c5 feat(05-01): mount /api/health + live useServiceHealth + wired TopBar dots ✓
