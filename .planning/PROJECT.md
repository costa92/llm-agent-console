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
      lifecycle actions the gateway exposes: write, patch, pin/unpin, disable/enable, delete; view session
      close/heartbeat state.
- [ ] **Flow console** — list/create/edit/delete flows (`/flows`), trigger runs, and **watch run progress
      live** via the flowd SSE stream (`/flows/{id}/run/stream`), plus browse past runs and replay events
      (`/runs/{id}/events`, `/runs/{id}/replay`).
- [ ] **Chat console** — send messages to the customer-support service and render the **streamed agent
      steps** (`/chat/stream` SSE), with session continuity.
- [ ] **BFF / proxy layer** — a thin server in this repo that fronts all three backends behind one origin,
      injects each service's auth server-side (gateway `X-Tenant-Id`/`X-User-Id` headers, flowd bearer token,
      chat none), and removes any browser-side CORS/secret-handling burden.
- [ ] **Service health / observability** — surface `/healthz`/`/readyz` and the gateway `/metrics` so an
      operator can see at a glance whether each backend is up.

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

- **Architecture**: thin BFF/proxy, single origin — the BFF injects all three auth models server-side; no browser-side CORS or secret handling. *(Chosen over direct+CORS for robustness/security and because the 3 services have 3 different auth models.)*
- **Tech stack**: **to be determined by GSD research** (2025 admin-console standard stack) — not pre-decided. The BFF may be Go (ecosystem-native) or the chosen frontend framework's server layer.
- **Repo placement**: separate sibling repo (`llm-agent-console`) nested under the umbrella, gitignored from it; its own git history + `.planning/`. *(Polyrepo convention.)*
- **Backend contracts are fixed**: consume the existing APIs unchanged; do not modify the backend services.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Unified console over all 3 services (not per-service apps) | One operator surface for the whole ecosystem; shared shell/auth/nav | — Pending |
| Thin BFF/proxy instead of direct browser→service + CORS | Single origin; server-side injection of 3 distinct auth models; no browser secret/CORS burden | — Pending |
| New sibling repo `llm-agent-console`, gitignored from umbrella | Matches the polyrepo split; independent history + planning | — Pending |
| Tech stack deferred to GSD research | No strong prior; let research recommend the current standard admin-console stack | — Pending |

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
*Last updated: 2026-06-02 after initialization*
