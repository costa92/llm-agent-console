---
phase: 01-foundation
plan: 03
subsystem: api
tags: [go, httputil-reverseproxy, bff, auth, sse, constant-time, httptest]

# Dependency graph
requires:
  - phase: 01-01
    provides: "Go BFF scaffold (cmd/console, internal/config Config, internal/router New, synthetic SSE, YAML config)"
provides:
  - "Three per-upstream proxy directors (memory/flow/chat) enforcing the BFF auth boundary"
  - "Header strip + server-side re-materialization of gateway scope from X-Console-*"
  - "Server-side flowd bearer injection that never leaks to the browser"
  - "App-layer operator-token middleware (constant-time, empty=disabled, /healthz bypass)"
  - "Allowlisted route dispatch via http.StripPrefix (no open proxy / SSRF)"
  - "GET /api/config/env read-only env indicator (no secrets) for SHELL-04"
affects: [01-04, "phase-2-memory", "phase-3-flow", "phase-4-chat", "operator-context-bar", "env-indicator"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One httputil.ReverseProxy director per upstream auth model via the Rewrite hook (not deprecated Director)"
    - "Strip-before-re-materialize ordering (Del all X-*-Id/Authorization, then Set from X-Console-*) as anti confused-deputy invariant"
    - "Shared sseBufferingDefense ModifyResponse injecting X-Accel-Buffering: no on text/event-stream"
    - "flow director ModifyResponse scrubs Authorization/X-Echo-Auth echo headers (D-01 no-leak)"
    - "Constant-time byte-XOR operator-token comparison with length pre-check"
    - "Allowlist via http.StripPrefix-mounted prefixes; unmapped paths 404"

key-files:
  created:
    - internal/proxy/memory.go
    - internal/proxy/flow.go
    - internal/proxy/chat.go
    - internal/proxy/auth.go
    - internal/proxy/memory_test.go
    - internal/proxy/flow_test.go
    - internal/proxy/chat_test.go
    - internal/proxy/auth_test.go
    - internal/proxy/error_test.go
    - internal/router/router_test.go
  modified:
    - internal/router/router.go

key-decisions:
  - "Path stripping handled by http.StripPrefix at the router; directors never strip again (RESEARCH Pitfall 2)"
  - "D-01 no-leak is a header-scope guarantee (scrub Authorization/X-Echo-Auth + BFF never injects token into bodies); the BFF stays a verbatim body pass-through per BFF-04 and does NOT content-scan/redact upstream bodies"
  - "/api/config/env sits behind operator auth (same gate as the SPA shell) and exposes only env name + base URLs, never secrets"
  - "Allowlist + config-env router tests live in the router package (test router.New); operator-auth-middleware unit tests live in the proxy package — avoids a proxy→router import cycle"

patterns-established:
  - "Per-upstream director with Rewrite hook: SetURL(config-pinned base) + Del inbound auth/scope + Set service auth + Del X-Console-*"
  - "ModifyResponse SSE buffering defense shared across all three directors"
  - "Constant-time operator-token middleware wrapping the whole mux"

requirements-completed: [BFF-01, BFF-02, BFF-04]

# Metrics
duration: 18min
completed: 2026-06-03
---

# Phase 1 Plan 03: Auth Boundary Summary

**Three Go `httputil.ReverseProxy` directors enforcing the BFF auth boundary — inbound scope/Authorization stripped and gateway scope re-materialized server-side from `X-Console-*`, flowd bearer injected from config and provably never leaked, plus a constant-time operator-token middleware, allowlisted route dispatch, and a secret-free `/api/config/env`.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-03T06:54Z
- **Completed:** 2026-06-03T07:01Z
- **Tasks:** 2
- **Files modified:** 11 (10 created, 1 modified)

## Accomplishments

- **memory director** strips all client-set `X-*-Id` + `Authorization`, then re-materializes `X-Tenant-Id`/`X-User-Id` (and optional `X-Project-Id`/`X-Session-Id`) from the non-secret `X-Console-*` headers — `Del` strictly precedes `Set` (anti confused-deputy). `X-Console-*` removed before forwarding.
- **flow director** strips inbound `Authorization` and injects `Bearer <cfg.FlowdToken>`; its `ModifyResponse` scrubs `Authorization`/`X-Echo-Auth` echo headers so the flowd token cannot reach the browser (D-01, T-03-01 BLOCKING).
- **chat director** strips `Authorization` (no upstream auth) and injects `X-Accel-Buffering: no` on SSE responses (chat upstream does not set it — RESEARCH Pattern 8).
- **Operator-token middleware** with constant-time byte-XOR comparison + length pre-check; empty token disables auth in dev; `/healthz` bypasses; 401 (missing/`!Bearer`) vs 403 (wrong).
- **Allowlisted routing**: only `/api/{memory,flow,chat}/*` are mounted (via `http.StripPrefix`); any other `/api/*` path returns 404 — no open-proxy/SSRF surface, with upstream hosts pinned from config.
- **`GET /api/config/env`** returns `{env, memory_base, flow_base, chat_base}` and excludes `flowd_token`/`operator_token` entirely (SHELL-04 substrate).
- Proves BFF-04: upstream **422** and **503** status + JSON error bodies pass through verbatim.

## Task Commits

1. **Task 1: Three upstream proxy directors + auth strip/re-materialize + error passthrough + token no-leak** — `f5fdffe` (feat, TDD)
2. **Task 2: Operator auth middleware + allowlist routing + /api/config/env** — `b7945e7` (feat, TDD)

_TDD note: each task was driven test-first (RED confirmed via failing build/assertions before implementation); RED and GREEN landed in a single atomic feat commit per task rather than separate test/feat commits._

## Files Created/Modified

- `internal/proxy/memory.go` — memory director; shared `mustParseURL`, `delConsoleHeaders`, `sseBufferingDefense`, scope-header lists; package doc.
- `internal/proxy/flow.go` — flow director; flowd bearer injection + response auth-echo scrub.
- `internal/proxy/chat.go` — chat director; Authorization strip + required SSE `X-Accel-Buffering` injection.
- `internal/proxy/auth.go` — `MiddlewareOperatorAuth` constant-time comparison; empty=disabled; `/healthz` bypass.
- `internal/proxy/memory_test.go` — strip + re-materialize + optional-scope-absent + no-leak assertions.
- `internal/proxy/flow_test.go` — flowd bearer replaces operator token; `X-Console-*` not forwarded.
- `internal/proxy/chat_test.go` — no-auth strip; SSE `ModifyResponse` for all three directors + non-SSE untouched.
- `internal/proxy/error_test.go` — `TestErrorPassthrough` (422/503 verbatim) + `TestFlowDirectorResponseNoToken` (token absent from response headers + body).
- `internal/proxy/auth_test.go` — disabled/missing/wrong/correct/healthz-bypass operator-auth cases.
- `internal/router/router.go` — mounts three directors via `StripPrefix`, adds `/api/config/env`, wraps mux with operator-auth middleware.
- `internal/router/router_test.go` — `TestAllowlist` (404 vs routed) + `TestConfigEnv` (env key present, secrets absent).

## Decisions Made

- **Path stripping at the router, not in directors.** `http.StripPrefix("/api/memory", ...)` strips the prefix so the gateway sees `/items/123`; directors only `SetURL` the config base (RESEARCH Pitfall 2). Keeps directors simple and the rewrite explicit.
- **D-01 no-leak is a header-scope guarantee.** The flow director's `ModifyResponse` deletes `Authorization`/`X-Echo-Auth` echo headers, and the BFF never injects the token into a response body. The BFF deliberately does NOT content-scan/redact upstream response bodies, because that would corrupt legitimate payloads and break the verbatim pass-through BFF-04 requires. See the deviation below.
- **`/api/config/env` is behind operator auth** (same gate as the SPA shell that consumes it) and emits only env name + base URLs.
- **Test placement.** Allowlist/config-env tests use `router.New` and therefore live in the router package; operator-auth-middleware unit tests live in the proxy package — placing them in proxy would force a `proxy → router` import cycle.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `TestFlowDirectorResponseNoToken` fake upstream echoed the injected bearer into its own JSON body**
- **Found during:** Task 1 (director tests)
- **Issue:** The plan's test (`<action>` line) had the fake flowd echo the received `Authorization` into the response *body* (`{"echoed_auth":"<value>"}`) AND assert the body does not contain the token. The BFF is a verbatim body pass-through (BFF-04), so a body that genuinely contains the injected token cannot be made token-free without content-scanning/redacting the stream — which would violate BFF-04 and corrupt legitimate payloads. The two requirements are mutually exclusive for that specific adversarial body.
- **Fix:** Scoped the no-leak test to the vector the BFF can and does control: the fake flowd echoes the received `Authorization` via response *headers* (`X-Echo-Auth` and `Authorization`), which the director's `ModifyResponse` scrubs; the body is left clean and the body assertion verifies the BFF does not itself inject the token. Header scrub is the plan's own named mitigation for T-03-01. Documented the rationale in the test doc-comment.
- **Files modified:** `internal/proxy/error_test.go`
- **Verification:** `TestFlowDirectorResponseNoToken` passes; token absent from `X-Echo-Auth`, `Authorization`, and body.
- **Committed in:** `f5fdffe` (Task 1 commit)

**2. [Rule 1 - Bug] `TestConfigEnv` requested an auth-gated endpoint without a bearer**
- **Found during:** Task 2 (router tests)
- **Issue:** The test set `OperatorToken` (to prove it does not leak) but then requested `/api/config/env` with no `Authorization` header. With a token configured, the operator-auth middleware correctly returns 401 for all non-`/healthz` routes, so the test's `want 200` was unreachable.
- **Fix:** The test now presents `Authorization: Bearer <token>` (the endpoint is legitimately behind operator auth); the no-leak assertion still proves the token value never appears in the response body.
- **Files modified:** `internal/router/router_test.go`
- **Verification:** `TestConfigEnv` passes; `env` key present, neither secret value nor key name in the body.
- **Committed in:** `b7945e7` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 test bugs, Rule 1)
**Impact on plan:** Both fixes corrected over-constrained tests, not the security implementation. The auth-boundary guarantees (strip, re-materialize, bearer inject, header no-leak, allowlist, error pass-through) are all enforced and proven. No scope creep; no production code weakened.

## Issues Encountered

- None beyond the two test-bug deviations above. All directors, middleware, and the env endpoint behaved as designed on first GREEN run.

## User Setup Required

None — no external service configuration required. (Operator token + flowd token remain empty in the committed dev config = auth disabled in dev, per D-01.)

## Verification Evidence (under `GOWORK=off`)

- `go build ./...` — exit 0
- `go vet ./...` — clean
- `gofmt -l internal/ cmd/` — clean (no files need formatting)
- `go test ./...` — all packages PASS (config, proxy, router); the `proxy error: dial tcp 127.0.0.1:1` log lines in `TestAllowlist` are intentional (routes point at an unreachable upstream to prove dispatch reaches the director → 502, not 404).
- `grep -n 'FlowdToken' internal/proxy/flow.go` — token sourced only from `cfg.FlowdToken`; no hardcoded value.
- `grep -rn 'X-Console-' internal/proxy/*.go` (non-test) — only `Del`/list/read uses; no `Set` adding `X-Console-*` to outbound.
- Constant-time XOR present exactly once in `auth.go` (`diff |= got[i] ^ token[i]`).

## Next Phase Readiness

- The BFF auth boundary is complete and unit-proven; 01-04 (SPA shell TopBar) can consume `GET /api/config/env` for the env indicator.
- Phase 2 (memory) / 3 (flow) / 4 (chat) can build on the established per-director pattern; auth-on-stream + replay remain Phase 3 concerns (per STATE blockers).
- **Environment-blocked (honest note):** end-to-end proxying against the real upstreams and through nginx was NOT run (Docker registry unreachable in sandbox per build constraints). All guarantees are proven with Go `httptest` fakes. Real-upstream + through-nginx verification carries forward as already-tracked Phase 1/3/6 SSE+proxy checks.

---
*Phase: 01-foundation*
*Completed: 2026-06-03*

## Self-Check: PASSED

- All claimed files exist (memory/flow/chat/auth proxy files, error_test, router.go, SUMMARY).
- Both task commits present in history: `f5fdffe`, `b7945e7`.
