# llm-agent-console — Deploy Guide

> SC-3 artifact. Documents all nginx proxy/buffering settings, deploy sequence, and umbrella integration notes.

## Overview

`llm-agent-console` is a two-service Docker Compose stack:

- **bff** — thin Go `httputil.ReverseProxy` BFF (`:8090`), builds from the repo root `Dockerfile`.
- **nginx** — fronting proxy that serves the built SPA at `/` and reverse-proxies `/api/*` to the BFF (`:80`).

Design decisions (D-04/D-05/D-06 from `01-CONTEXT.md`):

- **D-04**: Proxy-only BFF — no `go:embed` single-binary. SPA built separately, served by nginx.
- **D-05**: Single origin preserved by nginx: serves `web/dist/` at `/`, reverse-proxies `/api/*` to `bff:8090`. No CORS.
- **D-06**: SSE locations MUST set `proxy_buffering off; gzip off; proxy_http_version 1.1;`, pass `X-Accel-Buffering` through, and raise `proxy_read_timeout` (≥1h). The BFF is a pure pass-through — flowd/chat emit no heartbeats, so idle-period survival depends entirely on the nginx `proxy_read_timeout`.

The stack runs standalone alongside the rest of the ecosystem. It is **not** in `eco.sh launchable_repos` and is **not** started by the umbrella `make up`.

---

## Prerequisites

| Requirement | Verified version | Notes |
|-------------|-----------------|-------|
| Docker Engine | 29.5.2 | `docker --version` |
| Docker Compose | v5.1.4 | `docker compose version` |
| Node.js | 22.22.0 | `node --version`; needed for SPA build only |
| npm | 10.9.4 | `npm --version`; needed for SPA build only |

The three upstream services must be reachable at the URLs in `config/config.dev.yaml`:

| Service | Default port | Note |
|---------|-------------|------|
| memory-gateway | `:8080` | API mounts under `/memory/*` (`POST /memory/recall/unified`, etc.) — so `memory_base` must end in `/memory` (see config note below). |
| flowd | `:7861` | `POST /flows/{id}/run/stream`, `POST /runs/{id}/replay`, etc. — served at root, so `flow_base` is path-less. |
| customer-support (chat) | `:8081` | Default upstream is `:8080`; the dev config maps it to `:8081` to avoid collision with memory-gateway |

> The upstream URLs are configured in `config/config.dev.yaml` (or your `config/config.prod.yaml` for production). Adjust the host/port values to match your environment.

> **memory-gateway schema — run BOTH migration chains before first use.** The memory backend's schema lives across two repos: run `llm-agent-memory-gateway/cmd/memory-gateway-migrate` (gateway tables) **and** `llm-agent-memory-postgres/cmd/memory-migrate` (core `memory_record` / `memory_idempotency` / … tables), both with `LLM_AGENT_MEMORY_PG_URL` set to the gateway's Postgres. Running only the gateway migrate leaves writes failing with `503 upstream_unavailable` → `relation "memory_idempotency" does not exist`.

---

## Quick Start (dev — no real tokens needed)

```bash
# 1. From the repo root, build the SPA into web/dist/
make spa-build

# 2. Bring up the compose stack (builds the BFF Docker image, waits for health)
make up

# 3. Open the console
open http://localhost
# or: curl -sf http://localhost/healthz  →  {"status":"ok"}
```

`make up` depends on `spa-build` — it automatically builds the SPA first and then starts the stack. Running `make up` alone on a fresh checkout is sufficient.

To stop the stack:

```bash
make down
```

---

## Production Config Injection (Option A — bind-mount)

The BFF reads its config from a YAML file. For production, create `config/config.prod.yaml` on the deploy host with real tokens:

```yaml
# config/config.prod.yaml  — NEVER commit this file
# Keys match internal/config (yaml tags): flow_base / memory_base / chat_base /
# flowd_token / operator_token. Using flowd_url / memory_url / chat_url will NOT work.
flow_base: http://flowd-host:7861
flowd_token: <your-flowd-bearer-token>

# IMPORTANT: memory_base MUST include the /memory path segment. The gateway mounts
# its API under /memory/* and the BFF StripPrefixes /api/memory, so the base has to
# re-supply /memory or every memory call 404s. (flow_base/chat_base stay path-less.)
memory_base: http://memory-host:8080/memory

chat_base: http://chat-host:8081

operator_token: <your-operator-token>   # leave empty to disable operator auth
```

> **Warning: `config/config.prod.yaml` contains secrets — never commit this file.** It is already listed in `.gitignore`.

Then edit `deploy/docker-compose.yml` to uncomment the bind-mount block in the `bff` service:

```yaml
# In deploy/docker-compose.yml, under the `bff` service:
volumes:
  - ../config/config.prod.yaml:/app/config/config.prod.yaml:ro
command: ["/app/console", "--config", "/app/config/config.prod.yaml"]
```

(The compose file ships with this block already present but commented out — uncomment the three lines and the `command:` override.)

Bring the stack up normally:

```bash
make spa-build
make up
```

The dev default (`config.dev.yaml`, baked into the image) continues to work out of the box with no changes — no file creation is needed for local development.

---

## Nginx Proxy Settings (SC-3)

The console's nginx **is the edge proxy** — there is no upstream load balancer or reverse proxy in front of it. See GAP-6 in `06-RESEARCH.md` for the verified ecosystem scan.

> If a second proxy (e.g. Caddy for TLS) is added in the future, the settings in the tables below **MUST be replicated on that proxy for SSE routes**.

### SSE Location Directives

Source file: `deploy/nginx.conf`, location block `~* ^/api/.*(stream|replay)`.

| Setting | Value | Location in nginx.conf | Notes |
|---------|-------|------------------------|-------|
| `proxy_buffering` (SSE) | `off` | SSE location block | **MANDATORY** — enables per-event flush to the browser |
| `proxy_cache` (SSE) | `off` | SSE location block | Defense-in-depth against cache layers |
| `gzip` (global) | `off` | Global directive (top of file) | Belt-and-braces: prevents a stray `gzip on` from accidentally re-compressing (and thus re-buffering) an SSE response |
| `gzip` (SSE block) | `off` | SSE location block | Primary control — must be explicit even with the global directive |
| `proxy_read_timeout` (SSE) | `3600s` (1 hour) | SSE location block | Covers silent LLM tool steps >60s; flowd/chat emit no heartbeats |
| `proxy_send_timeout` (SSE) | `3600s` | SSE location block | Paired with `proxy_read_timeout` |
| `proxy_read_timeout` (REST) | `60s` | `/api/` location block | Standard timeout for short REST calls |
| `proxy_http_version` (SSE) | `1.1` | SSE location block | Required for chunked streaming |
| `Connection` header (SSE) | `''` (empty) | SSE location block | Plain HTTP/1.1 SSE — **not** a WebSocket upgrade; empty clears the hop-by-hop `Connection: keep-alive` header |
| `X-Accel-Buffering` | passed through (`proxy_pass_header`) | SSE location block | BFF `sseBufferingDefense` hook sets `no` on `text/event-stream` responses; nginx relays it unchanged |

### SSE Path Coverage

The SSE location regex `~* ^/api/.*(stream|replay)` matches all four SSE routes:

| SSE Path | Matches `(stream\|replay)` regex | Notes |
|----------|----------------------------------|-------|
| `/api/stream/test` | YES (`.*stream`) | Synthetic proof endpoint (dev/CI) |
| `/api/flow/*/run/stream` | YES (`.*stream`) | Live flowd flow-run SSE |
| `/api/flow/runs/*/replay` | YES (`.*replay`) | flowd replay SSE — GAP-1 fix (regex broadened from `.*stream` to `.*(stream\|replay)`) |
| `/api/chat/stream` | YES (`.*stream`) | Customer-support chat SSE |

> **Location ordering matters.** The SSE location block appears **before** the general `/api/` block in `nginx.conf`. nginx evaluates regex locations in declaration order — reversing the two blocks would silently route SSE traffic through the 60s-timeout REST block. Do not reorder. (See comment `T-01-02` in `deploy/nginx.conf`.)

---

## Umbrella Integration

The console runs as an independent compose stack. It is **not** integrated with the umbrella `eco.sh` or the umbrella `make up`.

| Item | Detail |
|------|--------|
| Compose file | `deploy/docker-compose.yml` (relative to repo root) |
| Start command | `docker compose -f deploy/docker-compose.yml up -d --build --wait` (or `make up`) |
| nginx port | `:80` (host → container `:80`) |
| BFF port | `:8090` (container-internal only; not published to host) |
| SPA assets | bind-mounted from `web/dist/` on the host; **must be built before `make up`** |
| Upstream services | Reached by the BFF container over the Docker bridge or host network — URLs in `config/config.dev.yaml` point to the host (e.g. `http://host.docker.internal:7861` for flowd if services are not on the same Docker network) |

The console is **gitignored from the umbrella** and lives in a separate sibling repo. Adding the console to `eco.sh launchable_repos` would require moving `deploy/docker-compose.yml` → `compose/compose.yaml` (the sibling convention). This is out of scope for MVP.

---

## SSE Verification

`scripts/sse-proof.sh` (run via `make proof`) exercises three legs:

| Part | Target | What it proves | Docker required |
|------|--------|---------------|-----------------|
| PART 1 | `http://localhost:8090/api/stream/test` (direct BFF) | Go `httputil.ReverseProxy` auto-flushes `text/event-stream` per event — no batching | No |
| PART 2 | `http://localhost/api/stream/test` (through nginx) | nginx SSE location fires for `.*stream` paths; `proxy_buffering off` + `gzip off` work | Yes |
| PART 3 | `http://localhost/api/replay/test` (through nginx) | nginx SSE location fires for `.*replay` paths — confirms the GAP-1 regex fix | Yes |

Each leg asserts ≥ 3 incremental `event: tick` frames within 5 seconds. If all frames arrive at once (batched), the leg fails.

Quick run:

```bash
make proof
```

PART 2 and PART 3 skip gracefully if Docker is unavailable (exit 0 with a skip message).

---

## Out of Scope (MVP Deferred)

The following are explicitly **not** configured for this MVP release:

| Item | Status | Notes |
|------|--------|-------|
| **TLS / HTTPS termination** | Deferred | Not configured. To add HTTPS, put a TLS proxy (Caddy, Traefik, nginx with cert) in front of nginx `:80`. Replicate SSE settings (see table above) on the TLS proxy for SSE routes. |
| **Secrets management** (Vault, Docker secrets) | Deferred | Bind-mount or env-var patterns are sufficient for MVP. The `config/config.prod.yaml` bind-mount approach is the documented path. |
| **Multi-replica / horizontal scaling** | Deferred | Single-instance compose only. Horizontal scaling would require shared session state and load-balancer SSE stickiness. |
| **CI/CD pipeline automation** | Deferred | Manual deploy workflow (`make spa-build && make up`). Automating deploys via GitHub Actions or similar is a follow-up. |
| **eco.sh integration** (`make up` from umbrella) | Deferred | Would require moving `deploy/docker-compose.yml` → `compose/compose.yaml` and adding the console to `eco.sh launchable_repos`. Out of scope. |
