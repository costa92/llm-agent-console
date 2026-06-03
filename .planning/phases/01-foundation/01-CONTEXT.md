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
- **D-01:** **Trusted-network by default + optional shared static operator token.** The BFF may enforce a single shared token (from config) on inbound operator requests; it is **off in local dev**. No login flow, no cookie session, no per-user RBAC in v1 — auth lives at the BFF/ingress layer (consistent with PROJECT.md "Out of Scope: per-end-user login/RBAC"). This is distinct from the *upstream* auth the BFF injects (flowd bearer, gateway scope headers).

### Upstream configuration
- **D-02:** The BFF is configured by a **config file (YAML preferred for comments; planner may choose JSON)** — the source of truth for the 3 upstream base URLs, the flowd bearer token, and the optional shared operator token. Env vars may *override* secrets but the file is primary (not env-var-first).
- **D-03:** A committed **local-dev sample config** points at the compose stack: gateway `http://localhost:8080`, flowd `http://localhost:7861`, chat `http://localhost:8081`. **Port-collision note:** memory-gateway and customer-support both default to `:8080` (verified in PROJECT.md) — they cannot co-locate on one host at the default; the sample maps chat to `:8081` and documents that the real chat port is operator-configured.

### Packaging / deployment topology
- **D-04:** **Proxy-only BFF** — the BFF does **not** embed the SPA (no `go:embed` single-binary). The SPA is built separately and served by a **fronting static host (e.g. nginx)**.
- **D-05:** **Single origin is preserved by the fronting host**, NOT by the BFF binary: nginx (or equivalent) serves the built SPA at `/` **and** reverse-proxies the API prefix (e.g. `/api/*`) to the BFF — same origin, no CORS. The locked "single-origin BFF auth model" (PROJECT.md) is intact; only the *file packaging* changed.
- **D-06 (hard constraint):** Because a fronting proxy now **always** sits in front, SSE-buffering hardening at that layer is **MANDATORY, not optional**: `proxy_buffering off` on stream routes, **no gzip** on `text/event-stream`, pass through `X-Accel-Buffering: no` + `Cache-Control: no-cache, no-transform`, long/no read timeout. The Phase-1 **BFF-03 SSE acceptance gate must be proven end-to-end THROUGH this fronting proxy** (with compression on) — not only against the BFF directly. This activates the research's previously-hypothetical "fronting proxy" caveat.
- **Dev loop:** Vite dev server (HMR) proxies the API prefix to the locally-run Go BFF — mirroring the prod fronting-proxy routing so dev and prod share the same single-origin shape.

### Operator-context entry UX
- **D-07:** **Persistent operator-context bar with inline edit** (click → popover) for tenant id / user id / optional project+session; **free-form text**; **last-used context remembered in `localStorage`**; when tenant/user is unset, the bar shows the amber "unusable" treatment and memory features are disabled (per UI-SPEC). A **"recent contexts" quick-select is deferred to v1.x** (see Deferred).

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
- `.planning/research/PITFALLS.md` — SSE buffering through proxy (now active per D-06); BFF auth boundary (strip inbound client scope headers + set gateway `X-Tenant-Id`/`X-User-Id` server-side; never leak the flowd bearer to the browser; allowlist mapped routes — no SSRF/confused-deputy).
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
- BFF-03's proof must use a real fronting proxy with compression on (`curl -N` + in-browser), per D-06.
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
