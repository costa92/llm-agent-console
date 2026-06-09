# Phase 6: Deploy - Research

**Researched:** 2026-06-09
**Domain:** Docker Compose service promotion, nginx SSE hardening, umbrella stack integration
**Confidence:** HIGH

<user_constraints>
## User Constraints (from Phase 1 CONTEXT.md — locked deploy decisions)

### Locked Decisions
- **D-04:** Proxy-only BFF — no `go:embed` single-binary. SPA built separately, served by fronting nginx.
- **D-05:** Single origin preserved by the fronting nginx: serves built SPA at `/`, reverse-proxies `/api/*` to the BFF. No CORS.
- **D-06 (hard):** SSE locations MUST set `proxy_buffering off; gzip off; proxy_http_version 1.1;`, pass through `X-Accel-Buffering: no` + `Cache-Control: no-cache, no-transform`, raised `proxy_read_timeout` (≥1h). BFF is a pure `httputil.ReverseProxy` pass-through — CANNOT inject heartbeats. flowd/chat emit NO heartbeat frames. Idle survival rides entirely on nginx `proxy_read_timeout` + client reconnect (Phase 5) + flowd `POST /runs/{id}/replay` resume.

### Existing Artifacts (Phase 1 proof harness — Phase 6 promotes these)
- `./Dockerfile` — multi-stage BFF build, `GOWORK=off`, builds `./cmd/console`
- `./deploy/docker-compose.yml` — 2-service: `bff:8090` + `nginx:80`
- `./deploy/nginx.conf` — SSE hardening per D-06 lives here (with one gap — see §Gap Analysis)
- `./scripts/sse-proof.sh` — through-nginx SSE proof harness (tests `/api/stream/test` only)

### Deferred (OUT OF SCOPE for MVP)
- TLS termination / HTTPS
- Secrets management (Vault, Docker secrets, etc.) beyond a bind-mounted config file
- Multi-replica / horizontal scaling
- CI/CD pipeline automation
- Grafana/metrics dashboards (OTEL stack already separate)
- Environment switcher UI (PROJECT.md out-of-scope)
</user_constraints>

## Summary

**The umbrella has NO fronting proxy or load balancer in front of the console's nginx.** [VERIFIED: grep of all compose files in umbrella] The only two launchable compose stacks (`llm-agent-otel`, `llm-agent-customer-support`) have no shared nginx, Traefik, or Caddy. The console's own nginx IS the edge — there is a single proxy hop for SSE, not two. This simplifies Phase 6: the SSE hardening already in `deploy/nginx.conf` is sufficient; no second-hop SSE configuration is required.

The proof harness in `deploy/docker-compose.yml` and `deploy/nginx.conf` is structurally correct and nearly complete. Phase 6 is a targeted **promotion** from a disposable proof fixture to a long-lived compose service. The work is four concrete changes: (1) fix a **confirmed nginx regex gap** that misses `/api/flow/runs/{id}/replay` SSE traffic, (2) add `restart: unless-stopped` to both services, (3) wire a `web/dist` build step into the compose lifecycle, (4) provide a prod-ready config injection path for secrets (`flowd_token`, `operator_token`).

The one genuine unknown before this research: whether the umbrella had a second proxy hop that would need SSE hardening. It does not. [VERIFIED: filesystem search]

**Primary recommendation:** Promote `deploy/docker-compose.yml` + `deploy/nginx.conf` with four targeted fixes. Do NOT move to `compose/compose.yaml` (the sibling convention) unless eco.sh integration is explicitly desired — this repo is gitignored from the umbrella and standalone operation is the MVP scope.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Serve built SPA static assets | nginx (fronting host) | — | D-04/D-05: nginx owns static serving; BFF is proxy-only |
| Reverse-proxy `/api/*` to BFF | nginx (fronting host) | — | D-05: single-origin preservation via nginx |
| SSE buffering/timeout hardening | nginx (fronting host) | BFF (`sseBufferingDefense` hook) | D-06: nginx = primary; BFF `ModifyResponse` = defense-in-depth |
| Operator auth injection | BFF (`MiddlewareOperatorAuth`) | — | D-01: app-layer token check at BFF |
| Upstream auth injection | BFF (per-director `Rewrite` hooks) | — | D-01: flowd bearer + gateway scope headers |
| Config/secrets injection | Docker volume bind-mount | env override (future) | D-02: config file primary |
| SPA build | host `npm run build` (pre-compose) | Dockerfile additional stage (future) | nginx bind-mounts `../web/dist`; Dockerfile has no Node stage today |
| Service restart recovery | Docker Compose `restart: unless-stopped` | — | long-lived service requirement (SC-1) |

## Standard Stack

No new packages are introduced by Phase 6. This phase modifies **config files and one Go source file** only.

### Core (existing — no changes needed)
| Component | Version | Purpose | Status |
|-----------|---------|---------|--------|
| `golang:1.26-alpine` (Dockerfile) | 1.26 | BFF build image | [VERIFIED: Dockerfile] — go.mod is `go 1.25`; using 1.26 builder is safe (forward-compatible). No alignment change needed for MVP. |
| `nginx:alpine` | alpine tag | Fronting host | [VERIFIED: deploy/docker-compose.yml] |
| `alpine:3.20` | 3.20 | BFF runtime base | [VERIFIED: Dockerfile] |

### Supporting (existing)
| Component | Version | Purpose | Status |
|-----------|---------|---------|--------|
| `gopkg.in/yaml.v3` | v3.0.1 | BFF config parsing | [VERIFIED: go.mod] |

### No New Dependencies
Phase 6 introduces no new Go modules or npm packages. All changes are to compose configuration, nginx config, and existing Go source.

## Package Legitimacy Audit

> Not applicable — no new packages are installed in this phase.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Gap Analysis: Proof Harness → Long-Lived Service

> This section is the core research output. Each gap is confirmed by source inspection.

### GAP-1 (BLOCKING): nginx SSE regex misses `/api/flow/runs/{id}/replay`

**Finding:** [VERIFIED: deploy/nginx.conf line 32 + manual regex test]

The current SSE location regex in `deploy/nginx.conf`:
```nginx
location ~* ^/api/.*stream {
```

This matches `/api/stream/test`, `/api/flow/flows/{id}/run/stream`, and `/api/chat/stream` — but it **does NOT match `/api/flow/runs/{id}/replay`** (the flowd `POST /runs/{id}/replay` SSE endpoint).

Verified by running the regex against all four SSE paths:
```
MATCH: /api/stream/test
MATCH: /api/flow/flows/123/run/stream
MISS:  /api/flow/runs/456/replay       ← GAP
MATCH: /api/chat/stream
```

The nginx.conf **comment** on line 31 even lists `/api/flow/*/runs/*/replay` as a target path for this location, but the regex does not implement it. Without the fix, replay SSE responses go through the general `/api/` proxy block, which has a 60s `proxy_read_timeout` and no `proxy_buffering off` — replay streams will be buffered and may time out for runs with slow LLM steps.

**Fix:** Change the regex to:
```nginx
location ~* ^/api/.*(stream|replay) {
```

This is the only nginx.conf change needed. All other D-06 hardening directives in the SSE block are correct [VERIFIED: deploy/nginx.conf full read].

### GAP-2: No `restart` policy on either service

**Finding:** [VERIFIED: deploy/docker-compose.yml] Neither `bff` nor `nginx` has a `restart:` key. After a crash or host reboot, both services stay down — not acceptable for a long-lived compose service.

**Fix:** Add `restart: unless-stopped` to both `bff` and `nginx` services. This matches the implicit expectation of SC-1 ("long-lived compose service") and is consistent with how Docker Compose long-lived services are operated [ASSUMED: industry standard; no umbrella example to compare since only `ollama-init` uses `restart: "no"` and `app` uses no explicit restart policy in the customer-support compose].

### GAP-3: `web/dist` is not built by Compose — silent empty SPA

**Finding:** [VERIFIED: Dockerfile, .gitignore, deploy/docker-compose.yml]

- `web/dist/` is gitignored (`/web/dist/` in `.gitignore`) — it is NOT committed.
- The `Dockerfile` has no Node.js stage — it builds only the Go BFF binary.
- The nginx service bind-mounts `../web/dist:/usr/share/nginx/html:ro`.
- **If `web/dist/` is absent or stale when `docker compose up` runs, nginx silently serves an empty directory** — the SPA appears missing with no obvious error.

The Phase 1 proof harness comments note this: `"absent until the SPA plan ships; the SSE proof only exercises /api/stream/test + /healthz, not the SPA root"`. As of Phase 5, the SPA is fully built — but the build must be run explicitly before compose up.

**Fix options (pick one for MVP):**
- **Option A (thinnest — recommended for MVP):** Add a `make build-spa` or `npm --prefix web run build` step to the deployment instructions and the `scripts/sse-proof.sh` PART 2 preamble. Document this as a required pre-step before `docker compose -f deploy/docker-compose.yml up`.
- **Option B:** Add a build stage to `Dockerfile` or a separate `web-builder` init-container service to compose. More self-contained but heavier. Out of scope for MVP (adds Node toolchain to Dockerfile or an extra compose service).

**MVP recommendation:** Option A — a `Makefile` target or documented pre-step. The `web/dist/` build takes ~5s locally and the output is deterministic.

### GAP-4: No production config injection path for secrets

**Finding:** [VERIFIED: config/config.go, config/config.dev.yaml, .gitignore]

The BFF `config.Load()` reads only a YAML file — there is **no env var override implemented** (the doc-comment says "Env vars may override secrets" but `os.Getenv` is never called). The committed dev config has empty `flowd_token` and `operator_token`. The gitignore excludes `config/config.local.yaml` as the intended non-committed override path.

For a production or shared-dev deploy that needs actual secrets, the current mechanism is: bind-mount a `config.prod.yaml` or `config.local.yaml` into the container at `/app/config/`. This works but requires the file to exist on the host.

**Fix (MVP — thinnest):** Add a Docker volume bind-mount for the production config to `deploy/docker-compose.yml`, and document the pattern:
```yaml
bff:
  volumes:
    - ./config.prod.yaml:/app/config/config.prod.yaml:ro
  command: ["/app/console", "--config", "/app/config/config.prod.yaml"]
```

The config.prod.yaml file is operator-created (not committed). For empty-token dev use, the existing `config.dev.yaml` baked into the image is sufficient — no change needed.

Alternatively, add a minimal env-var override to `config.Load()` for `FLOWD_TOKEN` and `OPERATOR_TOKEN` — clean and avoids file management. This is slightly more work but better operator ergonomics. **Either approach satisfies MVP.**

### GAP-5 (MINOR): BFF service has no healthcheck

**Finding:** [VERIFIED: deploy/docker-compose.yml] The nginx service has a healthcheck (wget `/healthz`) but the `bff` service has none. Compose's `depends_on: bff` check only waits for container start, not BFF HTTP readiness.

**Current nginx healthcheck:** `wget -qO- http://localhost/healthz` — this proxies through nginx to the BFF `/healthz` endpoint. So if the BFF isn't ready yet, the nginx healthcheck will fail until the BFF comes up, which effectively gates the whole stack. This is **passable for MVP** — the nginx healthcheck already validates the full path.

**If a stricter BFF healthcheck is wanted:** Add a dedicated BFF healthcheck using `curl -sf http://localhost:8090/healthz`. Note: `golang:1.26-alpine` runtime is `alpine:3.20` which ships `wget` but not `curl` — use `wget` for consistency:
```yaml
bff:
  healthcheck:
    test: ["CMD", "wget", "-qO-", "http://localhost:8090/healthz"]
    interval: 5s
    retries: 6
```

This is optional for MVP but recommended. Mark it as planner's discretion.

### GAP-6 (NON-ISSUE CONFIRMED): No second proxy hop in the umbrella

**Finding:** [VERIFIED: exhaustive filesystem search of all umbrella compose files]

Searched `/home/hellotalk/code/go/src/github.com/costa92/llm-agent-ecosystem/` for all `compose.yaml`/`docker-compose.yml` files excluding `llm-agent-console`:

```
/llm-agent-customer-support/compose/compose.yaml  — owns ollama + otel-lgtm + app:8080
/llm-agent-otel/compose/compose.yaml              — owns otel-lgtm + demo
```

**No shared nginx, Traefik, Caddy, or ALB exists** in the umbrella stack. Neither of these compose stacks has a fronting proxy that would sit in front of the console's nginx. The console's nginx is the edge — there is **one proxy hop, not two**. SC-3 ("Required LB/proxy idle-timeout and buffering settings documented for the deploy environment") is satisfied by documenting the console's own nginx settings.

The umbrella's `make up` delegates to `eco.sh up`, which only launches `llm-agent-otel` and `llm-agent-customer-support` (the `launchable_repos` list). `llm-agent-console` is NOT in this list and is gitignored from the umbrella — it runs independently. [VERIFIED: scripts/eco.sh launchable_repos array]

### GAP-7: eco.sh integration (optional, not MVP)

**Finding:** [VERIFIED: scripts/eco.sh]

`llm-agent-console` is absent from `eco.sh`'s `all_repos` and `launchable_repos`. The `make up`/`make down` commands won't start the console. For MVP, running `docker compose -f deploy/docker-compose.yml up -d` from the console repo is sufficient. Adding the console to eco.sh is a quality-of-life improvement, not a requirement.

**Sibling path convention mismatch:** Eco.sh expects compose files at `compose/compose.yaml` (e.g. `llm-agent-customer-support/compose/compose.yaml`). The console uses `deploy/docker-compose.yml`. Adding console to eco.sh would also require renaming/moving the compose file. **Out of scope for MVP** — document as optional follow-up.

## Architecture Patterns

### System Architecture Diagram

```
Browser
  │  HTTP (port 80, single origin)
  ▼
nginx:80  [deploy/nginx.conf]
  │  location ~* ^/api/.*(stream|replay)  → proxy_buffering off, proxy_read_timeout 3600s
  │  location /api/                         → proxy_read_timeout 60s
  │  location /                             → try_files $uri $uri/ /index.html  (SPA fallback)
  │
  ├── static assets ← /usr/share/nginx/html  (bind-mount: web/dist/)
  │
  └── proxy_pass http://bff:8090
        │
        ▼
      bff:8090  [Go httputil.ReverseProxy]
        ├── /api/memory/* → memory-gateway:8080  (X-Tenant-Id/X-User-Id injected)
        ├── /api/flow/*   → flowd:7861            (Authorization: Bearer injected)
        ├── /api/chat/*   → customer-support:8081 (no upstream auth)
        ├── GET /api/health    → parallel probe (flowd/chat/memory)
        ├── GET /api/config/env → non-secret env info
        ├── GET /api/stream/test → synthetic SSE (proof endpoint)
        └── GET /healthz  → {"status":"ok"}

Upstream services (outside this compose stack):
  memory-gateway:8080  (llm-agent-memory-gateway)
  flowd:7861           (llm-agent-flow)
  customer-support:8081 (llm-agent-customer-support — default :8080, config maps to :8081)
```

### Recommended Project Structure (deploy artifacts)

No structural changes. Existing files are promoted in-place:

```
deploy/
├── docker-compose.yml    # MODIFIED: restart policy, optional bff healthcheck
└── nginx.conf            # MODIFIED: SSE regex fix (stream|replay)
config/
├── config.dev.yaml       # UNCHANGED: committed dev sample (no secrets)
└── config.prod.yaml      # NOT COMMITTED: operator creates for production
scripts/
└── sse-proof.sh          # MODIFIED: add pre-step for web/dist build + replay SSE test
```

### Pattern 1: Promoting a proof harness to a long-lived service

**What:** Add `restart: unless-stopped` + healthcheck to compose services. Change label from "proof" to "production."

**When to use:** Any compose service intended to survive reboots and process crashes.

**Example (`deploy/docker-compose.yml` additions):**
```yaml
services:
  bff:
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8090/healthz"]
      interval: 5s
      retries: 6
    # ... existing keys unchanged

  nginx:
    restart: unless-stopped
    # ... existing keys unchanged
```

### Pattern 2: nginx SSE location with replay coverage (the fix)

**What:** Extend the SSE location regex to also match `/replay` endpoints.

**Source:** [CITED: nginx.org/en/docs/http/ngx_http_core_module.html#location — case-insensitive regex]

```nginx
# BEFORE (GAP: misses /api/flow/runs/{id}/replay)
location ~* ^/api/.*stream {

# AFTER (covers all 4 SSE paths)
location ~* ^/api/.*(stream|replay) {
    proxy_pass http://bff:8090;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_pass_header X-Accel-Buffering;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Connection '';
}
```

### Pattern 3: SPA build pre-step

**What:** Build `web/dist/` before starting nginx so the bind-mount is populated.

```bash
# Option A: explicit pre-step (recommended for MVP)
cd web && npm ci && npm run build
docker compose -f deploy/docker-compose.yml up -d

# Or as a Makefile target:
# make spa-build  (cd web && npm ci && npm run build)
# make up         (docker compose -f deploy/docker-compose.yml up -d --build)
```

### Pattern 4: Production config injection via volume

**What:** Bind-mount a non-committed prod config file with real secrets.

```yaml
# deploy/docker-compose.yml bff service (add to existing):
volumes:
  - ../config/config.prod.yaml:/app/config/config.prod.yaml:ro
command: ["/app/console", "--config", "/app/config/config.prod.yaml"]
```

`config/config.prod.yaml` is operator-created, never committed (gitignore already excludes `config/config.local.yaml`; add `config/config.prod.yaml` to gitignore as well).

### Anti-Patterns to Avoid

- **Putting the SSE location block AFTER the general `/api/` block:** nginx location matching tries the more-specific `/api/` prefix before the regex — but since `/api/` is an exact-prefix location and the SSE block is a regex, nginx evaluates all regex locations after prefix locations in a defined order. The SSE block is currently correctly placed BEFORE the general `/api/` block. Do NOT reorder. [VERIFIED: deploy/nginx.conf comment T-01-02 explains this]
- **Adding gzip back to non-SSE locations:** Global `gzip off` in nginx.conf is defense-in-depth. Do NOT re-enable even for static assets — the performance gain is marginal for an internal tool and the risk of accidentally buffering a stream is real.
- **Removing `proxy_pass_header X-Accel-Buffering` from the SSE block:** The BFF's `sseBufferingDefense` hook sets this header on `text/event-stream` responses. nginx must pass it through for any second-level proxy (future-proofing). Keep it. [VERIFIED: internal/proxy/memory.go sseBufferingDefense]
- **Building the SPA inside the BFF Dockerfile:** Would require a Node.js build stage and couples the two build systems. Avoid for MVP.

## End-to-End SSE Verification (SC-2)

### What the current proof covers

`scripts/sse-proof.sh` tests:
- PART 1: Direct BFF → `/api/stream/test` — confirms Go httputil.ReverseProxy auto-flushes
- PART 2: Through nginx → `/api/stream/test` — confirms nginx SSE block fires

**What it does NOT test:**
- The `/api/flow/runs/{id}/replay` path through nginx (the GAP-1 path)
- Real flowd SSE (`/api/flow/{id}/run/stream`)

### Recommended verification approach for Phase 6

**For SC-2, the minimum viable approach:**

1. **Fix GAP-1 (nginx regex)** — prerequisite.

2. **Extend `scripts/sse-proof.sh` with a PART 3: replay-path proof.** Two options:

   **Option A (recommended, no flowd dependency):** Add a synthetic `/api/replay/test` endpoint to the BFF that emits the same tick stream as `/api/stream/test`. Wire it at `router.go` alongside the existing synthetic endpoint. Then `sse-proof.sh` PART 3 curls `/api/replay/test` through nginx and asserts ≥3 incremental ticks — proving the `(stream|replay)` regex fires.

   This mirrors the Phase 1 approach (synthetic endpoint, no real upstream needed) and keeps the proof self-contained. The synthetic endpoint can be removed after Phase 6 or kept for regression.

   **Option B (proves real flowd path):** Start a real flowd instance (or the customer-support compose stack), trigger a `POST /api/flow/{id}/run/stream` through the deployed stack, and assert incremental events via `curl -N`. More realistic but requires live upstream services and is fragile in CI.

3. **Browser smoke test (SC-2 manual verification):** After compose up, open `http://localhost`, navigate to Flows, trigger a run, confirm the live timeline renders incrementally. This is the only way to confirm the React SSE client + nginx + BFF path works end-to-end.

### SC-3: LB/proxy settings documentation

Since there is no upstream LB/proxy (GAP-6 confirmed), SC-3 is satisfied by documenting the console's own nginx settings:

| Setting | Value | Location |
|---------|-------|----------|
| `proxy_buffering` | `off` | `deploy/nginx.conf` SSE block |
| `gzip` (global) | `off` | `deploy/nginx.conf` global |
| `gzip` (SSE block) | `off` | `deploy/nginx.conf` SSE block |
| `proxy_read_timeout` (SSE) | `3600s` (1 hour) | `deploy/nginx.conf` SSE block |
| `proxy_send_timeout` (SSE) | `3600s` | `deploy/nginx.conf` SSE block |
| `proxy_read_timeout` (REST) | `60s` | `deploy/nginx.conf` `/api/` block |
| `X-Accel-Buffering` | `no` (passed through) | `deploy/nginx.conf` + BFF `sseBufferingDefense` |
| `proxy_http_version` (SSE) | `1.1` | `deploy/nginx.conf` SSE block |
| `Connection` (SSE) | `''` (empty, not upgrade) | `deploy/nginx.conf` SSE block |

**No upstream LB exists.** The console's nginx is the edge proxy. [VERIFIED: filesystem search, no traefik/caddy/alb config found]

## Common Pitfalls

### Pitfall 1: Missing `web/dist` causes silent empty SPA
**What goes wrong:** `docker compose up` starts nginx, nginx finds `../web/dist` empty (because `web/dist/` is gitignored and not built). nginx serves an empty root with no error — the operator sees a blank page or 404, with no obvious failure in compose logs.
**Why it happens:** The SPA build step is not automated by compose or the Dockerfile.
**How to avoid:** Always run `cd web && npm run build` (or `npm ci && npm run build` on a fresh checkout) before `docker compose up`. Document as a mandatory pre-step. Add a `Makefile` target.
**Warning signs:** `docker compose logs nginx` shows no access to `index.html`, or the browser loads a blank page with no JS assets.

### Pitfall 2: nginx SSE regex misses replay → replay streams silently buffered
**What goes wrong:** After fixing GAP-1 is skipped, `POST /api/flow/runs/{id}/replay` goes through the general `/api/` proxy block with `proxy_read_timeout 60s` and no `proxy_buffering off`. The replay stream is silently batched and delivered all at once (or times out for slow runs).
**Why it happens:** The current regex `^/api/.*stream` does not match paths containing `replay`.
**How to avoid:** Apply the regex fix in GAP-1 before any SSE testing.
**Warning signs:** Replay timeline renders all events at once instead of sequentially; curl shows no incremental output through nginx but works direct-to-BFF.

### Pitfall 3: BFF config file not found inside container
**What goes wrong:** `docker compose up` fails with `config: cannot read config file "/app/config/config.dev.yaml"` if the Dockerfile's `COPY config/config.dev.yaml` step is omitted or the build context is wrong.
**Why it happens:** The Dockerfile copies `config/config.dev.yaml` from the repo root. If the build context is set to `deploy/` instead of `..` (the repo root), the COPY fails.
**How to avoid:** Verify `deploy/docker-compose.yml` has `build.context: ..` (one level up from `deploy/`). [VERIFIED: already correct in current file]

### Pitfall 4: SSE idle drop if `proxy_read_timeout` is not raised
**What goes wrong:** nginx's default `proxy_read_timeout` is 60s. A single slow LLM tool step that runs silently for >60s will cause nginx to close the connection mid-stream, sending no error to the client — the browser's fetch-event-source client sees a sudden stream end and starts reconnecting.
**Why it happens:** nginx interprets "no bytes from upstream for 60s" as an idle timeout.
**How to avoid:** The SSE block already has `proxy_read_timeout 3600s`. Do NOT reduce this. If future nginx config refactoring merges the SSE and REST blocks, the 1-hour timeout must be preserved on SSE routes.
**Warning signs:** Flow runs fail silently after ~60s; reconnect loop activates; client shows "Reconnecting…" state.

### Pitfall 5: `proxy_set_header Connection ''` vs `Connection: upgrade`
**What goes wrong:** A mistaken `Connection: upgrade` (WebSocket pattern) on the SSE location causes nginx to attempt an HTTP upgrade handshake, which the BFF does not support — the stream fails immediately.
**Why it happens:** Copy-paste from WebSocket nginx examples.
**How to avoid:** SSE is plain HTTP/1.1 streaming, NOT a WebSocket upgrade. The `Connection: ''` (empty) header is correct. [VERIFIED: deploy/nginx.conf comment]

## Runtime State Inventory

> Phase 6 is a compose/config promotion — no rename/refactor. This section is brief.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — no persistent data store in the console stack | None |
| Live service config | `deploy/docker-compose.yml` + `deploy/nginx.conf` are the only runtime config; both are in git and being modified | code edit |
| OS-registered state | No systemd units, cron, or task scheduler registrations | None |
| Secrets/env vars | `config/config.dev.yaml` shipped in container image; prod secrets via bind-mounted `config/config.prod.yaml` | document pattern; no rename |
| Build artifacts | `web/dist/` — pre-built SPA, must be present on host before `docker compose up` | build step required |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Go stdlib `testing` + `net/http/httptest` (existing); `scripts/sse-proof.sh` for integration |
| Config file | No test config file (Go stdlib) |
| Quick run command | `GOWORK=off go test ./... -count=1` |
| Full suite command | `GOWORK=off go test ./... -count=1 && ./scripts/sse-proof.sh` |

### Phase Requirements → Test Map

Phase 6 has no formal REQ-IDs in REQUIREMENTS.md. Success criteria map as follows:

| SC | Behavior | Test Type | Automated Command | Coverage |
|----|----------|-----------|-------------------|----------|
| SC-1 | Long-lived compose services start and stay up | integration | `docker compose -f deploy/docker-compose.yml up -d --wait && docker compose -f deploy/docker-compose.yml ps` | ✅ compose healthcheck |
| SC-2a | SSE `/api/stream/test` incremental through nginx | integration | `./scripts/sse-proof.sh` PART 2 | ✅ existing |
| SC-2b | SSE `/api/flow/runs/{id}/replay` incremental through nginx | integration | `./scripts/sse-proof.sh` PART 3 (new) | ❌ Wave 0 gap |
| SC-2c | Browser: flow run + chat render incrementally | manual | n/a | manual smoke test |
| SC-3 | Nginx settings documented | docs | n/a | ✅ this document |

### Wave 0 Gaps
- [ ] `scripts/sse-proof.sh` PART 3 — replay-path proof (add synthetic `/api/replay/test` BFF endpoint + nginx curl assertion)

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Compose services | ✓ | 29.5.2 | — |
| Docker Compose | Service orchestration | ✓ | v5.1.4 | — |
| Node.js / npm | `web/dist` build | ✓ | 22.22.0 / 10.9.4 | — |
| Go (GOWORK=off) | BFF build | ✓ | 1.25.0 | — |

**Missing dependencies with no fallback:** none

**Note on golang:1.26-alpine in Dockerfile:** Local Go is 1.25 but the Dockerfile uses `golang:1.26-alpine` as the build image. This is intentional and safe — Go is backward-compatible and the Dockerfile build is independent of the local toolchain. [VERIFIED: go.mod `go 1.25.0`; Dockerfile `FROM golang:1.26-alpine`]

## Security Domain

Phase 6 introduces no new auth surfaces. The security model is unchanged from Phases 1–5. The only change is operational:

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (existing) | BFF `MiddlewareOperatorAuth` — unchanged |
| V5 Input Validation | yes (existing) | BFF strips inbound scope headers — unchanged |
| V6 Cryptography | no new | operator token comparison is constant-time — unchanged |

**New security surface in Phase 6:** The `config/config.prod.yaml` bind-mount path must not be committed (already gitignored pattern `config/config.local.yaml` — add `config/config.prod.yaml` to `.gitignore` as well). This is the only new security action.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `restart: unless-stopped` is the correct restart policy for a long-lived internal tool | GAP-2 | Low — `always` also works; difference is only on explicit `docker compose stop` |
| A2 | No second-hop proxy will be added in front of the console's nginx | GAP-6 | Medium — if a reverse proxy is added later (e.g. Caddy for TLS), the SSE hardening steps in this document would need to be applied to that proxy as well |
| A3 | MVP does not require env-var override in `config.Load()` | GAP-4 | Low — bind-mounted config file is a working pattern; env-var override is strictly cleaner but not required |

## Open Questions

1. **Production config injection: bind-mount vs env-var override?**
   - What we know: `config.Load()` reads YAML only; `.gitignore` has `config/config.local.yaml`; D-02 says env vars may override secrets but this is not implemented.
   - What's unclear: Whether the operator prefers mounting a config file or injecting `FLOWD_TOKEN`/`OPERATOR_TOKEN` env vars (e.g. via Docker secrets or `.env` file).
   - Recommendation: MVP ships with bind-mount pattern. Planner adds a `checkpoint:human-confirm` on the prod config approach — it's a one-line choice. Adding env-var override to `config.Load()` is a ~15-line change if preferred.

2. **eco.sh integration for `make up` console?**
   - What we know: Console is gitignored from umbrella and not in `launchable_repos`. Adding it requires renaming `deploy/docker-compose.yml` → `compose/compose.yaml`.
   - Recommendation: Defer to post-MVP. Standalone `docker compose -f deploy/docker-compose.yml up -d` is sufficient. Mark as optional in the plan.

## Sources

### Primary (HIGH confidence)
- `deploy/nginx.conf` — [VERIFIED: file read] SSE location regex, hardening directives, comment about replay
- `deploy/docker-compose.yml` — [VERIFIED: file read] service definition, healthcheck, missing restart policy
- `scripts/eco.sh` — [VERIFIED: file read] launchable_repos, run_compose path convention
- `llm-agent-customer-support/compose/compose.yaml` — [VERIFIED: file read] sibling service deploy convention
- `llm-agent-flow/cmd/flowd/server/server.go` — [VERIFIED: file read] `POST /runs/{id}/replay` route registration, `writeSSE` no-heartbeat confirmation
- `llm-agent-customer-support/internal/httpapi/httpapi.go` — [VERIFIED: file read] chat `writeSSE` no-heartbeat confirmation
- `internal/proxy/memory.go` — [VERIFIED: file read] `sseBufferingDefense` hook implementation
- `internal/router/router.go` — [VERIFIED: file read] route table, synthetic SSE endpoint
- `config/config.go` — [VERIFIED: file read] `Load()` YAML-only, no env override implemented
- Filesystem search: `find /home/hellotalk/code/go/src/github.com/costa92/llm-agent-ecosystem -maxdepth 4 -name "compose*"` — [VERIFIED: Bash] confirmed no umbrella nginx/Traefik/Caddy

### Secondary (MEDIUM confidence)
- `scripts/sse-proof.sh` — [VERIFIED: file read] current proof scope, PART 1 + PART 2 only

### Tertiary (LOW confidence / ASSUMED)
- `restart: unless-stopped` as the correct restart policy [ASSUMED: standard Docker Compose practice; no umbrella precedent to compare]

## Metadata

**Confidence breakdown:**
- Umbrella proxy audit: HIGH — exhaustive filesystem search; no compose files with nginx/traefik/caddy found
- nginx gap analysis: HIGH — confirmed by regex test + source inspection
- Gap list: HIGH — each gap verified against actual source files
- Sibling deploy conventions: HIGH — direct reading of eco.sh + customer-support compose
- SSE verification approach: MEDIUM — synthetic endpoint option is pattern-matched from Phase 1; replay endpoint not yet implemented

**Research date:** 2026-06-09
**Valid until:** 2026-07-09 (stable infrastructure; eco.sh launchable_repos list could change if new services are added)
