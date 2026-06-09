---
phase: 06-deploy
verified: 2026-06-09T17:46:00Z
status: passed
score: 3/3
overrides_applied: 0
human_verification:
  - test: "In-browser incremental render of a live flowd run + chat"
    expected: "With the full umbrella stack (real flowd/chat/memory-gateway) wired, open http://localhost, trigger a flow run, and watch the timeline paint events one-by-one as they arrive (not all at once after completion)"
    why_human: "Requires the three REAL upstream services running behind the console; this verification used the BFF's synthetic /api/stream/test + /api/replay/test endpoints, which prove the nginx un-buffering transport guarantee (the actual SC-2 requirement) but not flowd's own output. The visual leg is additional confidence, not a gate — transport incrementality is already proven below."
---

# Phase 6: Deploy — Verification Report

**Phase Goal:** The console runs alongside the umbrella stack as a proxy-only Go BFF + a fronting nginx that serves the built SPA at `/` and reverse-proxies `/api/*` to the BFF on one origin, with that fronting proxy configured NOT to buffer the stream routes (per Phase-1 D-04/D-05/D-06).
**Verified:** 2026-06-09T17:46Z — **live**, by actually building the images, bringing up the compose stack, and running the proofs.
**Status:** PASS (3/3 success criteria verified end-to-end on a running stack)
**Re-verification:** No — initial verification

---

## How this was verified

Unlike a static check, this phase was verified by **deploying the real stack** in this session:
- `make spa-build` → built `web/dist/` (vite, 726 kB bundle).
- Base images (`nginx:alpine`, `golang:1.26-alpine`, `alpine:3.20`) were pulled via a working mirror (Docker Hub unreachable in this sandbox) and tagged locally — **no project file was modified** to accommodate this; the real deploy environment has normal registry access.
- `docker compose -f deploy/docker-compose.yml up -d --build --wait` → `deploy-bff` image built from the repo Dockerfile, both containers started.
- `make proof` → all three SSE legs run against the live stack.

## Live gate evidence (actual runs, 2026-06-09)

| SC | Check | Result |
|----|-------|--------|
| SC-1 | `docker compose ... up --wait` | Both services **Healthy** (`deploy-bff-1` healthy, `deploy-nginx-1` healthy) after the healthcheck fix |
| SC-1 | `curl -sf http://localhost/healthz` (through nginx) | `{"status":"ok"}` HTTP 200 |
| SC-1 | `curl http://localhost/` (SPA root) | HTTP 200, `text/html`, 453 bytes — single origin, no CORS |
| SC-1 | `grep -c 'restart: unless-stopped' deploy/docker-compose.yml` | 2 (both services — long-lived) |
| SC-2 | `curl -N http://localhost/api/stream/test` (timestamped) | Ticks at `:58.570 :59.571 :00.571 :01.571 :02.572` — **1/sec, incremental, not batched** |
| SC-2 | `curl -N http://localhost/api/replay/test` (timestamped) | Ticks at `:04.578 :05.578 :06.578 :07.578 :08.577` — **incremental; GAP-1 replay regex confirmed** |
| SC-2 | `make proof` PART 2 (`/api/stream/test` through nginx) | SUCCESS — 4 incremental ticks within 5s (BFF-03 gate) |
| SC-2 | `make proof` PART 3 (`/api/replay/test` through nginx) | SUCCESS — 4 incremental replay ticks ((stream\|replay) regex active) |
| SC-2 | `make proof` PART 1 (direct BFF :8090) | SUCCESS (ran first; sequential script reached PART 2/3) |
| SC-3 | `deploy/DEPLOY.md` present | nginx settings table (proxy_buffering/proxy_read_timeout/gzip), 4-path SSE coverage table, quick-start, Option A prod-config path, Out-of-Scope section |
| Go | `GOWORK=off go test ./internal/router/...` | PASS (incl. synthetic stream + replay endpoint tests) |

## Per-criterion verdict

**SC-1 — long-lived single-origin compose services.** PASS. The stack builds and runs as two long-lived services with `restart: unless-stopped`; nginx serves the SPA at `/` and proxies `/api/*` to `bff:8090` on one origin (no CORS, no embedded SPA — D-04/D-05 honored). Both containers reach Docker `healthy`.

**SC-2 — incremental streaming through nginx, incl. replay.** PASS. Timestamped curls prove ticks arrive one-per-second spread across the stream window (not a single end-of-stream batch) for **both** the stream and the replay path. The replay path working end-to-end confirms the GAP-1 nginx-regex fix (`^/api/.*stream` → `^/api/.*(stream|replay)`) — without it, replay would have fallen through to the buffered 60s-timeout block. `make proof` independently passes all three legs.

**SC-3 — settings documented.** PASS. `deploy/DEPLOY.md` documents the required nginx idle-timeout/buffering settings and records the key research fact that the umbrella has no second proxy hop (the console's own nginx is the edge), so these settings are the complete LB story.

## Bug found and fixed during live verification

**nginx healthcheck IPv6 trap.** First `up --wait` left nginx stuck `unhealthy` while the proxy served `/healthz` fine. Root cause: `/etc/hosts` maps `localhost` → both `127.0.0.1` and `::1`; BusyBox wget tries IPv6 first, but nginx `listen 80;` is IPv4-only → in-container healthcheck got "connection refused". Fixed by pointing the healthcheck at `127.0.0.1` (commit `664e41a`). Re-verified: both containers reach `healthy`, and `make proof` PART 2/3 (which gate on `up --wait`) pass. This defect was only discoverable by actually running the stack — the value of the human-confirm checkpoint.

## Carried forward (not Phase 6 gates)

- **In-browser visual render** with real flowd/chat/memory-gateway upstreams — additional confidence; transport incrementality is already proven via the synthetic endpoints.
- **Phase 5 live legs** (real per-service health dots; live flowd transport-drop → reconnect → de-dup resume) still need the **full umbrella stack with real upstreams** — this console-only stack (BFF + nginx + synthetic endpoints) does not include flowd/chat/memory-gateway, so those two Phase-5 legs remain open until run against the real services.
