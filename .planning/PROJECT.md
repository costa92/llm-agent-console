# llm-agent-console

## What This Is

A unified web **admin / ops console** for the `llm-agent` ecosystem. The ecosystem's
three HTTP services — the **memory gateway**, the **flow engine (flowd)**, and the
**customer-support chat** — are currently headless APIs with no frontend. This project
gives operators a single browser UI to observe and operate all three: inspect and manage
memory, build/run/replay flows, and drive chat sessions. It is an internal operator tool,
not an end-user product.

## Core Value

Turn the ecosystem's headless service APIs into one usable, observable operator surface.
If everything else fails, an operator must be able to **see and act on what the backend
services are doing** from a single web UI.

## Requirements

### Validated

(None yet — ship to validate)

### Active

<!-- Hypotheses until shipped + validated. v1 = unified console over the 3 services via a BFF. -->

- [ ] **Memory console** — search/recall (`/memory/recall/unified`), browse a memory item, and run the
      lifecycle actions the gateway exposes: write, patch, pin/unpin, disable/enable, delete. (Trigger session
      close/heartbeat — `POST /memory/sessions/{id}/close|heartbeat` — is deferred to v2: there is no read
      endpoint to *view* that state, so v1 surfaces no session-state view.)
- [ ] **Flow console** — list/create/edit/delete flows (`/flows`), trigger runs, and **watch run progress
      live** via the flowd SSE stream (`/flows/{id}/run/stream`), plus browse past runs and replay events
      (`/runs/{id}/events`, `/runs/{id}/replay`).
- [ ] **Chat console** — send messages to the customer-support service and render the **streamed agent
      steps** (`/chat/stream` SSE), with session continuity.
- [ ] **BFF / proxy layer** — a thin server in this repo that fronts all three backends behind one origin and
      injects each service's auth server-side. The browser conveys non-secret operator scope via
      `X-Console-Tenant`/`X-Console-User`/`X-Console-Project`/`X-Console-Session` headers (remembered in
      `localStorage`) and the optional shared operator token via `Authorization: Bearer` (held in memory, not
      `localStorage`); the BFF authenticates the operator token at the app layer (empty config = disabled in
      dev), strips ALL inbound `X-*-Id` scope headers and the inbound `Authorization`, then per allowlisted
      upstream re-materializes the gateway `X-Tenant-Id`/`X-User-Id`/… from the `X-Console-*` values and injects
      the flowd bearer from server config (chat: none). Secrets never reach the browser; identity headers are
      never client-trusted. The fronting nginx stays proxy-only (no auth). This removes any browser-side
      CORS/secret-handling burden.
- [ ] **Service health / observability** — surface flowd/chat `/healthz`/`/readyz`. memory-gateway exposes
      **only `/metrics`** (no `/healthz`/`/readyz`), so v1 "memory healthy" = transport reachability via a cheap
      probe (a `/metrics` scrape or a minimal request), NOT a non-existent `/healthz`. Surface the gateway
      `/metrics` so an operator can see at a glance whether each backend is up.

### Out of Scope

- **End-user / customer-facing product UI** — this is an internal operator console, not a polished consumer app. *(Keeps scope and auth model simple.)*
- **Replacing Grafana for deep metrics** — the compose stack already ships Grafana/OTEL; the console only surfaces top-line health, not full dashboards. *(Avoid rebuilding observability.)*
- **Multi-tenant SaaS auth / user management** — the BFF holds operator-side credentials; no per-end-user login system in v1. *(Internal tool.)*
- **A visual drag-and-drop DAG editor for flows** (v1) — v1 edits flow JSON and visualizes runs; a graphical builder is a future possibility. *(Large; defer until the read/run path proves valuable.)*
- **Modifying the backend services** — the console consumes existing APIs as-is; backend changes (e.g. adding CORS) are explicitly avoided in favor of the BFF. *(Surgical; don't fork backend contracts.)*

## Context

- **Polyrepo.** Part of the `llm-agent-ecosystem` umbrella; lives as a sibling repo nested under the
  umbrella directory and gitignored from it (per the polyrepo convention). The umbrella keeps its own
  `.planning/`; this repo has its own.
- **The three backends (verified against route code):**
  - **memory-gateway** (`:8080`): `POST /memory/recall/unified`, `POST /memory/write`,
    `PATCH /memory/items/{id}`, `POST .../pin|unpin|disable|enable`, `DELETE /memory/items/{id}`,
    `GET /memory/items/{id}`, `POST /memory/sessions/{id}/close|heartbeat`, `GET /metrics`.
    **Auth:** required `X-Tenant-Id` + `X-User-Id` headers (optional `X-Project-Id`, `X-Session-Id`).
  - **flowd** (`:7861`): `GET/POST /flows`, `GET/PUT/DELETE /flows/{id}`, `POST /flows/{id}/run`,
    `POST /flows/{id}/run/stream` (SSE), `GET /flows/{id}/runs`, `GET /runs/{id}`,
    `GET /runs/{id}/events`, `POST /runs/{id}/replay` (SSE), `GET /healthz`.
    **Auth:** optional bearer token (`FLOWD_TOKEN`); `/healthz` open.
  - **customer-support** (`:8080`): `POST /chat`, `POST /chat/stream` (SSE), `GET /healthz`, `GET /readyz`.
    **Auth:** none (IP rate-limited).
- **No frontend exists** anywhere in the ecosystem today — no HTML/JS/TS, no embedded assets. Confirmed.
- **SSE is central** — both flowd runs and chat stream Server-Sent Events; the console's value depends on
  rendering those live.

## Constraints

- **Architecture**: thin BFF/proxy, single origin — the BFF injects all three upstream auth models server-side; no browser-side CORS or secret handling. The BFF is **proxy-only**; single origin is preserved by a **fronting static host (nginx)** that serves the built SPA at `/` and reverse-proxies `/api/*` to the BFF (Phase-1 decision — not `go:embed`). The browser supplies non-secret operator scope as `X-Console-*` headers and the optional operator token as `Authorization: Bearer`; the BFF authenticates that token at the app layer, strips inbound `X-*-Id` scope headers + inbound `Authorization`, and re-materializes the gateway scope headers + flowd bearer on each upstream hop. The fronting nginx is proxy-only (no auth). *(Chosen over direct+CORS for robustness/security and because the 3 services have 3 different auth models.)*
- **Tech stack** (locked by GSD research 2026-06-03): **React 19 + Vite SPA** (TanStack Router/Query + shadcn/ui + Tailwind v4, TypeScript pinned 5.9.x) + a thin **Go `httputil.ReverseProxy` BFF**; SSE consumed via `@microsoft/fetch-event-source` because the stream endpoints are SSE-over-POST (native `EventSource` is unusable).
- **Repo placement**: separate sibling repo (`llm-agent-console`) nested under the umbrella, gitignored from it; its own git history + `.planning/`. *(Polyrepo convention.)*
- **Backend contracts are fixed**: consume the existing APIs unchanged; do not modify the backend services.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Unified console over all 3 services (not per-service apps) | One operator surface for the whole ecosystem; shared shell/auth/nav | ✓ Locked (roadmap) |
| Thin BFF/proxy instead of direct browser→service + CORS | Single origin; server-side injection of 3 distinct auth models; no browser secret/CORS burden | ✓ Locked |
| New sibling repo `llm-agent-console`, gitignored from umbrella | Matches the polyrepo split; independent history + planning | ✓ Done |
| Stack: React 19 + Vite SPA + Go ReverseProxy BFF (research) | Research-recommended 2025 admin-console stack; Go auto-flushes SSE | ✓ Locked (research 2026-06-03) |
| Packaging: proxy-only BFF + separately-hosted static SPA (fronting nginx) | Operator chose separation over `go:embed` single-binary; nginx unifies origin + serves SPA | ✓ Locked (Phase-1 CONTEXT) — fronting proxy is now a mandatory SSE-buffering surface |
| BFF operator-auth: `X-Console-*` scope headers + app-layer shared operator token | Internal tool; no login/RBAC. Browser sends non-secret scope as `X-Console-*` + optional `Authorization: Bearer`; BFF checks the token at the app layer (empty = disabled in dev), strips inbound `X-*-Id`/`Authorization`, re-materializes gateway scope + flowd bearer per upstream. Token in-memory (not `localStorage`); nginx proxy-only, no auth | ✓ Locked (Phase-1 CONTEXT) |
| Upstream config via config file (YAML), not env-first | File is source of truth; env overrides secrets only | ✓ Locked (Phase-1 CONTEXT) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-03 — stack locked by research; packaging/auth/config locked by Phase-1 discussion; auth boundary set to `X-Console-*` + app-layer token, SSE heartbeat = pure pass-through (no BFF heartbeat)*
