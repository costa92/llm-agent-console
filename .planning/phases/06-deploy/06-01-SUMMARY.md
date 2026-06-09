---
phase: "06-deploy"
plan: "01"
subsystem: "deploy/bff"
tags: [nginx, docker-compose, sse, tdd, gap-fix]
dependency_graph:
  requires: []
  provides:
    - "deploy/nginx.conf: SSE regex ^/api/.*(stream|replay) — GAP-1 closed"
    - "deploy/docker-compose.yml: restart: unless-stopped + bff healthcheck — GAP-2 closed"
    - "internal/router: GET /api/replay/test synthetic endpoint — SC-2 prereq"
    - ".gitignore: config/config.prod.yaml excluded — T-06-01 mitigated"
  affects:
    - "06-02 sse-proof.sh (uses /api/replay/test + nginx regex)"
tech_stack:
  added: []
  patterns:
    - "TDD RED-GREEN on Go httptest.NewServer (streaming, not recorder)"
    - "Structural handler mirror pattern (syntheticReplaySSEHandler mirrors syntheticSSEHandler)"
key_files:
  created: []
  modified:
    - "deploy/nginx.conf"
    - "deploy/docker-compose.yml"
    - ".gitignore"
    - "internal/router/router.go"
    - "internal/router/router_test.go"
decisions:
  - "syntheticReplaySSEHandler is a structural copy of syntheticSSEHandler (not a shared helper) — test isolation over DRY; the two endpoints are independent probes"
  - "TestSyntheticReplaySSEHandler uses httptest.NewServer (real socket) not httptest.NewRecorder — recorder does not flush incrementally, would block for 30 ticks"
metrics:
  duration: "3min"
  completed: "2026-06-09"
  tasks_completed: 2
  files_modified: 5
---

# Phase 06 Plan 01: Foundation Fixes Summary

One-liner: Closed GAP-1 (nginx SSE regex broadened to stream|replay), GAP-2 (restart: unless-stopped on both services), and added synthetic /api/replay/test endpoint via TDD RED-GREEN for SC-2 proof prerequisite.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix nginx SSE regex + compose restart policy + .gitignore | 3dfbc7a | deploy/nginx.conf, deploy/docker-compose.yml, .gitignore |
| 2 (RED) | TestSyntheticReplaySSEHandler — failing test | e3e817c | internal/router/router_test.go |
| 2 (GREEN) | syntheticReplaySSEHandler implementation | 3c6fbad | internal/router/router.go |

## Verification Results

All plan verification checks passed:

- `grep -c '(stream|replay)' deploy/nginx.conf` → **1** (GAP-1 closed)
- `grep -c 'restart: unless-stopped' deploy/docker-compose.yml` → **2** (GAP-2 closed, both services)
- `grep -c 'config.prod.yaml' .gitignore` → **1** (T-06-01 mitigated)
- `GOWORK=off go build ./...` → **BUILD OK**
- `GOWORK=off go test ./internal/router/ -run TestSyntheticReplay -count=1` → **PASS**
- `GOWORK=off go test ./... -count=1` → **PASS** (all packages, no regressions)

## Deviations from Plan

None — plan executed exactly as written.

## TDD Gate Compliance

- RED commit `e3e817c`: `test(06-01): add failing TestSyntheticReplaySSEHandler (RED)` — gate PASS (test failed with 404 before implementation)
- GREEN commit `3c6fbad`: `feat(06-01): add syntheticReplaySSEHandler + register GET /api/replay/test (GREEN)` — gate PASS (test passes after implementation)

## Key Changes

### deploy/nginx.conf

Changed the SSE location regex from `^/api/.*stream` (missed replay) to `^/api/.*(stream|replay)` — replay SSE streams now enter the unbuffered SSE location block instead of the 60s-timeout REST block. Only the comment and the regex line were modified; all SSE directives (`proxy_buffering off`, `gzip off`, `proxy_read_timeout 3600s`, `Connection ''`, `proxy_pass_header X-Accel-Buffering`) are unchanged.

### deploy/docker-compose.yml

Added `restart: unless-stopped` to both `bff` and `nginx` service definitions (SC-1 long-lived service requirement). Added a dedicated `healthcheck` block to the `bff` service using `wget -qO- http://localhost:8090/healthz` (alpine:3.20 ships wget, not curl) with `interval: 5s, retries: 6`.

### internal/router/router.go

Added `syntheticReplaySSEHandler` — a structural mirror of the existing `syntheticSSEHandler` with identical SSE transport headers and tick emission loop. Registered as `GET /api/replay/test` alongside `GET /api/stream/test` in `New()`. The existing handler and `syntheticTicks` constant were not modified.

### .gitignore

Added `/config/config.prod.yaml` alongside the existing `/config/config.local.yaml` entry to prevent future bind-mounted production secrets from being accidentally committed (T-06-01).

## Known Stubs

None.

## Threat Flags

None — all threat mitigations from the plan were applied:
- T-06-01 (config.prod.yaml in .gitignore): DONE
- T-06-02 (regex broadening — accept): documented above, no new proxy targets

## Self-Check: PASSED

- deploy/nginx.conf: present, contains `(stream|replay)`
- deploy/docker-compose.yml: present, contains 2x `restart: unless-stopped`
- .gitignore: present, contains `config.prod.yaml`
- internal/router/router.go: present, contains `/api/replay/test` and `syntheticReplaySSEHandler`
- internal/router/router_test.go: present, contains `TestSyntheticReplaySSEHandler`
- Commit 3dfbc7a: exists
- Commit e3e817c: exists
- Commit 3c6fbad: exists
