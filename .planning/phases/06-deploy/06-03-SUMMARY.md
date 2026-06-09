---
phase: "06-deploy"
plan: "03"
subsystem: "deploy/docs"
tags: [nginx, sse, documentation, sc-3, deploy-guide]
dependency_graph:
  requires:
    - "06-01: nginx SSE regex + /api/replay/test synthetic endpoint"
    - "06-02: Makefile spa-build/up/proof + sse-proof.sh PART 3 + Option A compose"
  provides:
    - "deploy/DEPLOY.md: SC-3 artifact — nginx proxy settings table (10 rows), SSE path coverage table (4 paths), quick-start, Option A prod config, Out-of-Scope section"
  affects:
    - "Operator: has documented deploy procedure + verification steps"
tech_stack:
  added: []
  patterns:
    - "Docs-as-artifact: DEPLOY.md cross-references nginx.conf directive names as the SC-3 documentation anchor"
key_files:
  created:
    - "deploy/DEPLOY.md"
  modified: []
decisions:
  - "SC-3 satisfied by documenting the console's own nginx settings (no upstream LB exists — GAP-6 confirmed); the table rows are drawn directly from deploy/nginx.conf"
  - "Option A (bind-mount) documented as the prod config injection path per 06-02 checkpoint resolution"
  - "human-confirm checkpoint is PENDING-OPERATOR — Docker execution + browser smoke test cannot be automated; steps listed verbatim below"
metrics:
  duration: "1min"
  completed: "2026-06-09"
  tasks_completed: 1
  files_modified: 1
---

# Phase 06 Plan 03: SC-3 Documentation + Deploy Guide Summary

One-liner: Wrote deploy/DEPLOY.md capturing all 10 nginx proxy/buffering directives, 4-path SSE coverage table, make spa-build/up quick-start, Option A prod config bind-mount, and explicit MVP out-of-scope list (TLS, secrets-manager, multi-replica, CI/CD, eco.sh).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write deploy/DEPLOY.md (SC-3 documentation artifact) | a6c8664 | deploy/DEPLOY.md (new, 194 lines) |

## Verification Results

All Task 1 checks passed:

- `test -f deploy/DEPLOY.md` → **EXISTS**
- `grep -c 'proxy_buffering' deploy/DEPLOY.md` → **3** (≥1 required)
- `grep -c 'stream|replay' deploy/DEPLOY.md` → **2** (≥1 required)
- `grep -c 'proxy_read_timeout' deploy/DEPLOY.md` → **4** (≥1 required)
- `grep -c 'Out of Scope' deploy/DEPLOY.md` → **1** (≥1 required)

## Human-Confirm Checkpoint — PENDING-OPERATOR

**Status: PENDING-OPERATOR**

The human-confirm checkpoint (Task 2 in the plan) cannot be executed by the agent — it requires Docker + a browser. The operator must run all 10 verification steps below and type "approved" to complete Phase 6.

### Verbatim Operator Verification Steps

**[SC-1: Long-lived compose services]**

1. From the repo root: `make spa-build` — should complete without errors and create/update `web/dist/`
2. `make up` — docker compose up -d --build --wait — should exit 0; both services should be healthy
3. `docker compose -f deploy/docker-compose.yml ps` — confirm `bff` and `nginx` are "running (healthy)"
4. `curl -sf http://localhost/healthz` — should return `{"status":"ok"}`
5. `curl -sf http://localhost` — should return an HTML page (the SPA)

**[SC-2: Streamed flow runs + chat render incrementally; replay path unbuffered]**

6. `make proof` (or `./scripts/sse-proof.sh`) — all three legs should pass:
   - PART 1: direct-BFF delivers >= 3 incremental ticks
   - PART 2: through-nginx `/api/stream/test` delivers >= 3 incremental ticks
   - PART 3: through-nginx `/api/replay/test` delivers >= 3 incremental ticks
7. Browser smoke test: open `http://localhost` in your browser, navigate to the Flows section, trigger a flow run (or use a test flow), and confirm the live timeline renders events incrementally as they arrive — NOT all at once after the run completes.
8. (Optional replay path): If a completed run exists, click Replay and confirm the timeline renders events incrementally rather than all at once.

**[SC-3: Settings documented]**

9. Open `deploy/DEPLOY.md` and confirm:
   - The nginx settings table is present with `proxy_buffering`, `proxy_read_timeout`, `gzip` entries
   - The SSE path coverage table shows 4 paths with the `(stream|replay)` note on the replay row
   - "Out of Scope" section lists TLS, secrets-manager, multi-replica, CI/CD, eco.sh

**[Restart policy check]**

10. `grep restart deploy/docker-compose.yml` — should show `unless-stopped` for both services

**Expected outcome:** Steps 1–6 and 10 are fully automated and should all pass. Steps 7–8 require a browser and may require real flowd/chat services to be running. Step 9 is a doc review.

**Resume signal:** If ALL automated checks pass and the browser smoke test confirms incremental rendering, type "approved" to complete Phase 6. If any check fails, describe which step failed and what you observed.

## Deviations from Plan

None — plan executed exactly as written. The human-confirm checkpoint is intentionally not marked complete; it is PENDING-OPERATOR per the execution instructions.

## Known Stubs

None. The document contains no placeholder text, hardcoded empty values, or TODOs that affect the plan's goal (SC-3: documentation).

## Threat Flags

None. `deploy/DEPLOY.md` contains no actual secrets, upstream IPs, or internal hostnames beyond localhost and generic `:8080/:7861/:8081` port references already in `PROJECT.md` (public). Mitigations T-06-05 and T-06-SC from the plan's threat model are satisfied.

## Phase 06 Status

| Plan | Status | Key Deliverable |
|------|--------|----------------|
| 06-01 | COMPLETE | nginx SSE regex fix (GAP-1), restart: unless-stopped (GAP-2), /api/replay/test endpoint |
| 06-02 | COMPLETE | Makefile (GAP-3), sse-proof.sh PART 3, Option A compose bind-mount (GAP-4) |
| 06-03 | DOC COMPLETE / CHECKPOINT PENDING | deploy/DEPLOY.md (SC-3); operator verification steps above |

Phase 06 is functionally complete pending the operator running `make proof` (Docker) and the browser incremental-render smoke test.

## Self-Check: PASSED

- `deploy/DEPLOY.md`: present (194 lines)
- Contains all 10 nginx settings rows (proxy_buffering, proxy_cache, gzip×2, proxy_read_timeout×2, proxy_send_timeout, proxy_http_version, Connection, X-Accel-Buffering)
- Contains SSE path coverage table with all 4 paths and `(stream|replay)` note
- Contains Out of Scope section listing TLS, secrets manager, multi-replica, CI/CD, eco.sh
- Commit a6c8664: exists (`git log --oneline -1` confirms)
- Human-confirm checkpoint: PENDING-OPERATOR (verbatim steps documented above)
