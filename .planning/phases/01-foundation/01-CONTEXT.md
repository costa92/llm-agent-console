# Phase 1: Foundation - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 delivers the **foundation slice**: a single-origin **Go `httputil.ReverseProxy` BFF** (allowlisted routes → the 3 backend services, server-side auth injection, verified unbuffered SSE pass-through) + a **React 19 + Vite SPA shell** (persistent Memory/Flow/Chat nav, operator-context bar, active-env indicator, per-service health dots) + the **cross-cutting primitives** every later phase reuses (five-state pattern, app-wide toast, raw-JSON viewer, copyable id).

Covers REQ BFF-01..04 and SHELL-01/03/04/05/06/07. **Not** in this phase: the per-service feature screens (Memory=Phase 2, Flow=Phase 3, Chat=Phase 4) and live health polling (SHELL-02=Phase 5; Phase 1 ships only the health-dot *visual contract* with an initial `unknown` state).

Stack, SSE mechanics, and the visual system are already LOCKED (research + UI-SPEC). This discussion settled the choices those left open.
</domain>

<decisions>
## Implementation Decisions

### BFF operator authentication
- **D-01:** **App-layer shared operator token + `X-Console-*` scope headers (no cookie).** The browser sends the optional shared operator token as `Authorization: Bearer` to the same-origin BFF; the BFF authenticates it at the **app layer** (empty config = **disabled in dev**). No login flow, no cookie session, no per-user RBAC in v1 — auth lives at the BFF/ingress layer (consistent with PROJECT.md "Out of Scope: per-end-user login/RBAC"). **The fronting nginx is proxy-only — it does NOT do auth.** This operator token is distinct from the *upstream* auth the BFF injects (flowd bearer, gateway scope headers re-materialized from `X-Console-*`). The token is held **in memory** (runtime-injected config), never in `localStorage`.

### Upstream configuration
- **D-02:** The BFF is configured by a **config file (YAML preferred for comments; planner may choose JSON)** — the source of truth for the 3 upstream base URLs, the flowd bearer token, and the optional shared operator token. Env vars may *override* secrets but the file is primary (not env-var-first).
- **D-03:** A committed **local-dev sample config** points at the compose stack: gateway `http://localhost:8080`, flowd `http://localhost:7861`, chat `http://localhost:8081`. **Port-collision note:** memory-gateway and customer-support both default to `:8080` (verified in PROJECT.md) — they cannot co-locate on one host at the default; the sample maps chat to `:8081` and documents that the real chat port is operator-configured.

### Packaging / deployment topology
- **D-04:** **Proxy-only BFF** — the BFF does **not** embed the SPA (no `go:embed` single-binary). The SPA is built separately and served by a **fronting static host (e.g. nginx)**.
- **D-05:** **Single origin is preserved by the fronting host**, NOT by the BFF binary: nginx (or equivalent) serves the built SPA at `/` **and** reverse-proxies the API prefix (e.g. `/api/*`) to the BFF — same origin, no CORS. The locked "single-origin BFF auth model" (PROJECT.md) is intact; only the *file packaging* changed.
- **D-06 (hard constraint):** Because a fronting proxy now **always** sits in front, SSE-buffering hardening at that layer is **MANDATORY, not optional**: on SSE locations set `proxy_buffering off; gzip off; proxy_http_version 1.1;`, pass through `X-Accel-Buffering: no` + `Cache-Control: no-cache, no-transform`, and a **raised `proxy_read_timeout` (e.g. ≥1h)**. **Heartbeat is upstream-absent and the BFF injects none:** the BFF is a pure `httputil.ReverseProxy` pass-through and CANNOT inject SSE keepalives (a ReverseProxy structurally cannot); flowd (`writeSSE`) and chat (`writeSSE`) emit no `:` heartbeat / `retry:` / `id:`, and both go silent for the full duration of any single slow LLM/tool step (>30–60s common). So **idle-timeout survival is handled at the fronting nginx via the raised `proxy_read_timeout`** (plus the browser fetch-stream client's reconnect and flowd's `POST /runs/{id}/replay` resume) — **NOT** by BFF-side heartbeat injection, which is explicitly deferred/out of scope unless a deploy hop's idle timeout proves unraisable.
  - **BFF-03 proof split:** Phase 1 proves only the **transport** end-to-end THROUGH this fronting proxy (with compression on) — unbuffered per-event flush, no gzip, and idle-period survival through the real proxy via `curl -N` + browser — and **may use a synthetic test-stream endpoint**. **Auth injection on the stream hop, upstream-heartbeat-absence, and replay semantics are proven in Phase 3** against real flowd. This activates the research's previously-hypothetical "fronting proxy" caveat.
- **Dev loop:** Vite dev server (HMR) proxies the API prefix to the locally-run Go BFF — mirroring the prod fronting-proxy routing so dev and prod share the same single-origin shape.

### Operator-context entry UX
- **D-07:** **Persistent operator-context bar with inline edit** (click → popover) for tenant id / user id / optional project+session; **free-form text**. The bar's values are sent to the BFF as `X-Console-Tenant`/`X-Console-User`/`X-Console-Project`/`X-Console-Session` headers (the BFF re-materializes them into the gateway `X-Tenant-Id`/… server-side). **Only this non-secret context is remembered in `localStorage`** (the operator token is held in memory only — see D-01). When tenant/user is unset, the bar shows the amber "unusable" treatment and memory features are disabled (per UI-SPEC). A **"recent contexts" quick-select is deferred to v1.x** (see Deferred).

### Claude's Discretion
- Config file format (YAML vs JSON) — YAML preferred (comments); planner decides.
- The API route prefix and per-service namespacing (e.g. `/api/memory/*`, `/api/flow/*`, `/api/chat/*`).
- The exact **SSE-proof mechanism** for BFF-03 (a synthetic test-stream endpoint in the BFF vs proxying a real flowd run) — leave to phase research/planner, but it MUST run through the fronting proxy per D-06.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project specs (locked)
- `.planning/PROJECT.md` — locked decisions: single-origin BFF, internal operator tool, backend contracts fixed, the 3 services' verified route + auth inventory.
- `.planning/REQUIREMENTS.md` — this phase's requirements: BFF-01..04, SHELL-01/03/04/05/06/07.
- `.planning/ROADMAP.md` §"Phase 1: Foundation" — goal + 5 success criteria.

### Design contract (APPROVED — MUST follow for any UI)
- `.planning/phases/01-foundation/01-UI-SPEC.md` — approved design system (shadcn/ui on Radix + Tailwind v4, dark-first), shell layout (context bar / env indicator / health dots), and the five-state / toast / raw-JSON-viewer / copyable-id primitive contracts.

### Research (locked stack + pitfalls)
- `.planning/research/STACK.md` — LOCKED: React 19 + Vite SPA (TanStack Router/Query, shadcn/ui, Tailwind v4, TS 5.9.x) + thin Go `httputil.ReverseProxy` BFF; `@microsoft/fetch-event-source` because both stream endpoints are SSE-over-POST (native `EventSource` unusable).
- `.planning/research/ARCHITECTURE.md` — BFF boundary (one director per upstream), REST-vs-SSE data-flow split, vertical-slice build order.
- `.planning/research/PITFALLS.md` — SSE buffering through proxy (now active per D-06); BFF auth boundary (**strip inbound `X-*-Id` scope headers + inbound `Authorization`, then re-materialize the gateway `X-Tenant-Id`/`X-User-Id` from the browser's `X-Console-*` values server-side**; never leak the flowd bearer to the browser; allowlist mapped routes — no SSRF/confused-deputy).
- `.planning/research/FEATURES.md` — table-stakes legibility primitives this phase ships.
- `.planning/research/SUMMARY.md` — research synthesis + 6-phase implication.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **None — greenfield.** The repo contains only `.planning/` + `CLAUDE.md`; no application code yet. The BFF and SPA are both created in this phase.

### Established Patterns
- **shadcn/ui is initialized during this phase's execution** (not yet present) — the UI-SPEC is the design-system source of truth until then.

### Integration Points
- The 3 backend services live as **sibling repos under the umbrella** (`../llm-agent-memory-gateway`, `../llm-agent-flow`, `../llm-agent-customer-support`). The BFF reaches them **over HTTP at configured URLs** — it does **not** import their Go packages. Their route + auth contracts are inventoried in `PROJECT.md` and are fixed.
- This repo (`llm-agent-console`) is a standalone sibling, gitignored from the umbrella, with its own git history + `.planning/`. No GitHub remote yet.
</code_context>

<specifics>
## Specific Ideas

- The backend route inventory and the three auth models (gateway header-scope / flowd bearer / chat none) are verified in `PROJECT.md` — treat as authoritative.
- The two stream endpoints (`POST /flows/{id}/run/stream`, `POST /chat/stream`, plus `POST /runs/{id}/replay`) are **SSE-over-POST** — the BFF must pass these through unbuffered and the browser client is fetch-stream, not `EventSource`.
- **Confirmed from source:** flowd (`writeSSE` in `cmd/flowd/server/server.go`) and chat (`writeSSE` in `internal/httpapi/httpapi.go`) emit `event:`/`data:` frames only — no `:` heartbeat, no `retry:`, no `id:` — so the BFF (a pure pass-through that cannot inject keepalives) injects none; idle survival rides on nginx `proxy_read_timeout` (D-06). The header re-materialization point is also confirmed: memory-gateway `internal/authz/scope.go` reads `X-Tenant-Id`/`X-User-Id` (required) + optional `X-Project-Id`/`X-Session-Id`, and `MergeAuthoritativeScope` forces the header values over any body scope; flowd `cmd/flowd/server/auth.go` is optional `Authorization: Bearer` with a `/healthz` bypass. Body-conveyance of scope is rejected because the BFF must not buffer/parse the SSE-over-POST request bodies; `X-Console-*` headers work for both REST and fetch-event-source POST.
- BFF-03's proof must use a real fronting proxy with compression on (`curl -N` + in-browser), per D-06 — Phase 1 proves transport only (synthetic stream allowed); auth-on-stream + replay are proven in Phase 3.
</specifics>

<deferred>
## Deferred Ideas

- **"Recent contexts" quick-select** in the operator-context bar — v1.x (D-07 ships free-form + last-used only).
- **Single-binary `go:embed` packaging** — explicitly NOT chosen (D-04 = proxy-only + separate static host). Recorded in case a single-artifact deploy is wanted later.
- **Env-var-first configuration** — not chosen (D-02 = config-file primary); env stays as a secret-override path only.
- None of the above expand phase scope — they are refinements/alternatives, not new capabilities.
</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-06-03*
