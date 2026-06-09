---
phase: "06-deploy"
plan: "02"
subsystem: "deploy/automation"
tags: [makefile, sse-proof, docker-compose, config-injection, gap-3, gap-4, sc-2]
dependency_graph:
  requires:
    - "06-01: nginx SSE regex + /api/replay/test synthetic endpoint"
  provides:
    - "Makefile: spa-build + up + down + proof targets — GAP-3 closed"
    - "scripts/sse-proof.sh PART 3: /api/replay/test through-nginx proof — SC-2 replay covered"
    - "deploy/docker-compose.yml: Option A commented bind-mount for config.prod.yaml — GAP-4 closed"
  affects:
    - "06-03: operator runs make up + make proof to verify full stack"
tech_stack:
  added: []
  patterns:
    - "Makefile dependency chain: up depends on spa-build (npm --prefix web ci + run build then docker compose up)"
    - "PART 3 reuse-or-start pattern: check compose ps before bringing up stack to avoid double-up"
key_files:
  created:
    - "Makefile"
  modified:
    - "scripts/sse-proof.sh"
    - "deploy/docker-compose.yml"
decisions:
  - "Checkpoint resolved to Option A (bind-mount): commented-out volumes/command block in compose; dev config.dev.yaml default unchanged; operator creates config.prod.yaml on deploy host"
  - "PART 3 brings up a fresh compose stack (PART 2 tears it down); PART3_STARTED flag gates teardown to avoid double-down"
  - "spa-build uses npm ci --prefer-offline with fallback to npm install for environments without a cache"
metrics:
  duration: "5min"
  completed: "2026-06-09"
  tasks_completed: 1
  files_modified: 3
---

# Phase 06 Plan 02: Build Automation + SSE Replay Proof + Config Injection Summary

One-liner: Closed GAP-3 (Makefile spa-build/up targets automating web/dist build before compose), GAP-4 (Option A commented bind-mount for prod config), and SC-2 replay proof (sse-proof.sh PART 3 curls /api/replay/test through nginx asserting >=3 incremental ticks).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| checkpoint:decision | GAP-4 prod config injection | pre-resolved (Option A) | — |
| 2 | Makefile + sse-proof PART 3 + Option A compose update | 2bd9507 | Makefile (new), scripts/sse-proof.sh, deploy/docker-compose.yml |

## Verification Results

Static verification (Docker execution deferred to 06-03 human-confirm):

- `bash -n scripts/sse-proof.sh` → **syntax OK**
- `grep -c 'PART 3' scripts/sse-proof.sh` → **6** (banner, step labels, assertions, success/failure messages)
- `grep -c 'replay/test' scripts/sse-proof.sh` → **5**
- `grep -c 'spa-build' Makefile` → **5**
- `grep -c 'config.prod.yaml' deploy/docker-compose.yml` → **3** (comment, volumes line, command line)
- Makefile recipe lines use real TABs (`^I` confirmed via `cat -A`)

## Checkpoint Resolution

**checkpoint:decision (GAP-4) — Pre-resolved to Option A (bind-mount config file):**

The operator pre-selected Option A before execution. No Go code change was made. The `deploy/docker-compose.yml` bff service now contains a commented-out block:

```yaml
# Production: uncomment the lines below and create config/config.prod.yaml
# (the file is gitignored and must be created on each deploy host with real tokens).
# volumes:
#   - ../config/config.prod.yaml:/app/config/config.prod.yaml:ro
# command: ["/app/console", "--config", "/app/config/config.prod.yaml"]
```

The default dev config (`config.dev.yaml`) continues to work out-of-the-box with no changes. Option B (env-var override in `config.Load()`) was explicitly NOT implemented.

## Key Changes

### Makefile (new)

Four targets with TAB-indented recipes:
- `spa-build`: `npm --prefix web ci --prefer-offline || npm --prefix web install` then `npm --prefix web run build` — closes GAP-3
- `up: spa-build`: depends on spa-build, then `docker compose -f deploy/docker-compose.yml up -d --build --wait`
- `down`: `docker compose -f deploy/docker-compose.yml down`
- `proof`: `./scripts/sse-proof.sh`

### scripts/sse-proof.sh

Appended PART 3 after the PART 2 block:
- Skips with exit 0 if Docker is unavailable (same guard as PART 2)
- Checks compose stack state via `$COMPOSE ps --quiet bff`; brings up fresh stack if down
- Runs `curl -N http://localhost/api/replay/test --max-time 5 > /tmp/sse-replay.txt`
- Counts `REPLAY_TICKS=$(grep -c 'event: tick' /tmp/sse-replay.txt ...)`
- Asserts `REPLAY_TICKS >= MIN_TICKS (3)`
- Failure message: "PART 3 FAILURE: nginx did not deliver incremental replay ticks ($REPLAY_TICKS < $MIN_TICKS). Check: location ~* ^/api/.*(stream|replay) in deploy/nginx.conf."
- Success message names GAP-1 fix explicitly
- `PART3_STARTED` flag gates teardown: only tears down if PART 3 started the stack
- Updated final banner: "BFF-03 + REPLAY PROOF COMPLETE — all three legs incremental"

### deploy/docker-compose.yml

Added commented-out Option A production config injection block to the `bff` service. Dev default (`config.dev.yaml` baked into image) unchanged.

## Deviations from Plan

None — plan executed exactly as written (checkpoint pre-resolved by operator; Task 2 implemented verbatim per plan action).

## Known Stubs

None. The Makefile targets and sse-proof.sh PART 3 are fully wired. No placeholder text or empty data flows.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: Information Disclosure | deploy/docker-compose.yml | T-06-03 mitigated: commented block explicitly warns the prod config file is gitignored and operator-created; comment text: "the file is gitignored and must be created on each deploy host with real tokens" |

## Self-Check: PASSED

- Makefile: present, contains `spa-build`
- scripts/sse-proof.sh: present, contains `PART 3` (6 occurrences) and `replay/test`
- deploy/docker-compose.yml: present, contains `config.prod.yaml` (3 occurrences)
- Commit 2bd9507: exists
- bash -n scripts/sse-proof.sh: exits 0 (syntax valid)
- Makefile recipe TABs: confirmed via cat -A
