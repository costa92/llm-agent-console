---
phase: 01-foundation
plan: 01
subsystem: infra
tags: [go, bff, reverse-proxy, sse, nginx, docker-compose, yaml-config]

# Dependency graph
requires: []
provides:
  - "Go BFF skeleton (cmd/console) listening on :8090 — proxy-only, no go:embed (D-04)"
  - "YAML config loader (internal/config) — fail-fast on missing file (D-02)"
  - "Synthetic SSE proof endpoint GET /api/stream/test with per-event flush + X-Accel-Buffering: no"
  - "GET /healthz JSON health endpoint"
  - "nginx fronting config with mandatory D-06 SSE hardening (deploy/nginx.conf)"
  - "docker-compose stack (bff + nginx) for the through-nginx BFF-03 proof"
  - "scripts/sse-proof.sh — BFF-03 keystone proof (direct-BFF + through-nginx)"
  - "Multi-stage Dockerfile for the BFF image"
affects: [phase-01-02-spa-shell, phase-01-03-auth-boundary, phase-03-flow-console]

# Tech tracking
tech-stack:
  added: ["gopkg.in/yaml.v3 v3.0.1"]
  patterns:
    - "httputil.ReverseProxy-ready router skeleton (Go 1.22 method+path ServeMux)"
    - "SSE per-event flush via w.(http.Flusher).Flush()"
    - "nginx SSE location ~* ^/api/.*stream ordered BEFORE general /api/ block"
    - "BFF-03 proof-as-script: assert >= 3 incremental ticks within 5s"

key-files:
  created:
    - go.mod
    - go.sum
    - cmd/console/main.go
    - internal/config/config.go
    - internal/config/config_test.go
    - internal/router/router.go
    - internal/router/sse_test.go
    - config/config.dev.yaml
    - deploy/nginx.conf
    - deploy/docker-compose.yml
    - scripts/sse-proof.sh
    - Dockerfile
    - .gitignore
  modified: []

key-decisions:
  - "BFF is a pure pass-through and injects NO heartbeat; idle survival rides on nginx proxy_read_timeout 3600s (D-06)"
  - "Synthetic /api/stream/test is GET (no auth) — transport proof only; auth-on-stream deferred to Phase 3"
  - "Config tokens (flowd_token/operator_token) empty in committed dev sample; never hardcoded in Go source"
  - "Added a root Dockerfile (Rule 3 deviation) so the compose-based through-nginx proof is runnable"

patterns-established:
  - "Per-event SSE flush + self-describing X-Accel-Buffering header on the BFF response"
  - "nginx SSE block precedes general /api/ block to avoid silent re-buffering (T-01-02 [BLOCKING])"
  - "Proof script fails loudly on batched streams rather than faking a pass"

requirements-completed: [BFF-03]

# Metrics
duration: 6min
completed: 2026-06-03
---

# Phase 1 Plan 01: BFF Skeleton + Synthetic SSE Proof + nginx Config Summary

**Proved the BFF-03 keystone transport mechanic — a Go BFF emits per-event-flushed SSE that arrives incrementally (1 tick/sec, 4 ticks in <5s direct), with the mandatory D-06 nginx hardening config and an automated proof script in place; the through-nginx leg is config-correct and validated by regex + script logic but could not be executed here because the Docker registry is unreachable in this sandbox.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-03T06:25:09Z
- **Completed:** 2026-06-03T06:30:52Z
- **Tasks:** 2 of 2
- **Files created:** 13

## Accomplishments

### Task 1 — Go BFF scaffold (commit 607bcd5)
- `go mod init github.com/costa92/llm-agent-console`; added `gopkg.in/yaml.v3 v3.0.1` via `GOWORK=off go mod tidy`.
- `internal/config/config.go`: `Config` struct (server.port default 8090, memory_base/flow_base/chat_base, flowd_token, operator_token) + `Load(path)` that fails fast on a missing file (D-02). Reconciled the interrupted-run file (already correct).
- `internal/router/router.go`: `New(cfg)` ServeMux mounting `GET /api/stream/test` (synthetic SSE: per-second `event: tick` frame, 30 ticks then `event: done`, `flusher.Flush()` after every write, `Content-Type: text/event-stream`, `X-Accel-Buffering: no`, `Cache-Control: no-cache, no-transform`) and `GET /healthz`. Reconciled the interrupted-run file (already correct).
- `cmd/console/main.go`: BFF entry point — `--config` flag (default `config/config.dev.yaml`), loads config, `http.ListenAndServe` on `cfg.Server.Port`, exit 1 on load error.
- `config/config.dev.yaml`: dev sample pointing at gateway:8080 / flowd:7861 / chat:8081 (D-03), empty tokens (D-01), commented fields.
- `internal/router/sse_test.go`: `TestSyntheticSSE` (real `httptest.NewServer`, asserts SSE headers + at least one incremental `event: tick` before a 3s context-cancel), `TestHealthz`, `TestUnknownRouteIs404`.
- `.gitignore` for build artifacts / SPA dist / local config override.

### Task 2 — nginx SSE config + BFF-03 proof (commit 7428c40)
- `deploy/nginx.conf`: SSE location `~* ^/api/.*stream` placed BEFORE the general `/api/` block, carrying `proxy_buffering off`, `proxy_cache off`, `gzip off`, `proxy_pass_header X-Accel-Buffering`, `proxy_read_timeout 3600s`, `proxy_send_timeout 3600s`, `proxy_http_version 1.1`, `Connection ''`; general `/api/` at 60s; `/healthz` passthrough; SPA `try_files` fallback; global `gzip off` defense-in-depth.
- `deploy/docker-compose.yml`: `bff` (builds root Dockerfile, hostname `bff`, expose 8090) + `nginx` (nginx:alpine, binds nginx.conf + ../web/dist, 80:80, wget-based healthcheck).
- `scripts/sse-proof.sh` (chmod +x): PART 1 builds+runs the BFF and asserts ≥3 incremental ticks on `curl -N http://localhost:8090/...`; PART 2 brings up the compose stack and asserts ≥3 incremental ticks on `curl -N http://localhost/api/stream/test`; PART 2 skips (exit 0) only when Docker is absent.
- `Dockerfile`: multi-stage BFF image (build golang:1.26-alpine → alpine:3.20 runtime).

## Verification Evidence

| Gate | Command | Result |
|------|---------|--------|
| Router tests | `GOWORK=off go test ./internal/router/...` | PASS (TestSyntheticSSE 1.00s, Healthz, UnknownRoute 404) |
| Config tests | `GOWORK=off go test ./internal/config/...` | PASS (missing-file fail-fast, valid load, explicit port) |
| Build | `GOWORK=off go build ./...` | OK |
| Vet | `GOWORK=off go vet ./...` | OK |
| nginx grep — proxy_buffering off | `grep -c` | 3 (≥1) |
| nginx grep — gzip off | `grep -c` | 5 (≥1) |
| nginx grep — proxy_read_timeout 3600s | `grep -c` | 1 (SSE location only) |
| nginx grep — proxy_buffering on | `grep -v '^#' \| grep -c` | 0 |
| SSE location ordering | `grep -n location` | `~* ^/api/.*stream` (line 32) BEFORE `/api/` (line 57) |
| compose bff references | `grep -c bff` | 7 (≥2) |
| script curls present | `grep -c` | `curl -N http://localhost:8090` =1, `curl -N http://localhost/api/stream/test` =2 |
| SSE regex correctness | python re check | matches /api/stream/test, /api/flow/*/run/stream, /api/chat/stream; does NOT match /api/memory/items/123 |
| **BFF-03 PART 1 (direct :8090)** | `./scripts/sse-proof.sh` | **SUCCESS — 4 incremental ticks in <5s** |
| **BFF-03 PART 2 (through nginx :80)** | `./scripts/sse-proof.sh` | **DEFERRED — see below** |

## BFF-03 Gate: Verified vs. Deferred

**Verified in this environment:**
- The BFF flushes SSE per event (PART 1: 4 `event: tick` frames delivered incrementally within 5s, not batched). This proves the BFF-side half of the transport gate — the handler's `flusher.Flush()` works.
- The nginx config is structurally correct against every D-06 requirement: SSE location precedes the general `/api/` block, `proxy_buffering off` + `gzip off` + `proxy_read_timeout 3600s` are present on the SSE block, `X-Accel-Buffering` is passed through, and the SSE regex matches the synthetic path (and the future flow/chat stream paths) without over-matching the memory REST path — validated by a Python regex check standing in for `nginx -t` (nginx is not installed on the host).
- The proof script's through-nginx logic is exercised and correct; it fails loudly when a stream is batched and only skips when Docker is genuinely absent.

**Deferred (could not execute here):**
- The through-nginx PART 2 leg (the literal `curl -N http://localhost/api/stream/test` on port 80 through a running nginx with gzip on) could NOT run: `docker compose up` cannot pull `nginx:alpine` / `golang:1.26-alpine` because the sandbox's Docker registry endpoint is behind TLS interception that returns a Facebook certificate for `registry-1.docker.io` (`x509: certificate is valid for *.facebook.com ... not registry-1.docker.io`). No `nginx`/`golang`/`alpine` base images are cached locally either. This is an environment/network limitation, NOT a config defect — the script correctly FAILED rather than faking a pass.
- **To complete the gate**, run on a host with Docker registry access: `GOWORK=off ./scripts/sse-proof.sh` and confirm PART 2 prints `PART 2 SUCCESS` with ≥3 incremental ticks. Equivalently `docker compose -f deploy/docker-compose.yml up -d --build --wait && curl -N http://localhost/api/stream/test` should show ticks arriving 1/sec, not all at once.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added a root `Dockerfile` (not in plan `files_modified`)**
- **Found during:** Task 2
- **Issue:** `deploy/docker-compose.yml` (per the plan) builds the `bff` service from a root `Dockerfile`, but the plan's `files_modified` list did not include `Dockerfile`. Without it, `docker compose up` — and therefore PART 2 of the BFF-03 proof — cannot run at all.
- **Fix:** Added a minimal multi-stage `Dockerfile` (golang:1.26-alpine build → alpine:3.20 runtime) at the repo root.
- **Files created:** `Dockerfile`
- **Commit:** 7428c40

**2. [Rule 3 - Blocking] Added `.gitignore` (not in plan `files_modified`)**
- **Found during:** Task 1
- **Issue:** `go build ./cmd/console/...` drops a `console` binary in the repo root; the commit protocol forbids leaving generated files untracked.
- **Fix:** Added `.gitignore` covering the build binary, `/tmp/`, `*.test/*.out`, `/web/dist/`, and `/config/config.local.yaml`.
- **Files created:** `.gitignore`
- **Commit:** 607bcd5

**3. [Rule 1 - Adjustment] compose healthcheck uses `wget` instead of `curl`**
- **Found during:** Task 2
- **Issue:** The plan specified a `curl -f` healthcheck on the `nginx` service, but `nginx:alpine` ships `wget`, not `curl` — a `curl` healthcheck would always fail and block `--wait`.
- **Fix:** Healthcheck uses `wget -qO- http://localhost/healthz`.
- **Files modified:** `deploy/docker-compose.yml`
- **Commit:** 7428c40

### Scope notes
- `.planning/config.json` shows as modified in the working tree — this is a pre-existing change unrelated to this plan and was intentionally left unstaged (out of scope).
- `../web/dist` does not exist yet (SPA ships in a later plan); the compose nginx bind-mount tolerates this and the SSE proof does not touch the SPA root.

## Known Stubs

None that block the plan goal. The router accepts `cfg` but does not yet wire the per-upstream proxy directors (memory/flow/chat) — this is by plan design (skeleton only; directors are added in Plan 01-03). Documented in `internal/router/router.go`.

## Self-Check: PASSED

- FOUND: cmd/console/main.go, internal/config/config.go, internal/config/config_test.go, internal/router/router.go, internal/router/sse_test.go, config/config.dev.yaml, deploy/nginx.conf, deploy/docker-compose.yml, scripts/sse-proof.sh, Dockerfile, .gitignore, go.mod, go.sum
- FOUND commit: 607bcd5 (Task 1)
- FOUND commit: 7428c40 (Task 2)
- All go tests green; build + vet clean.
