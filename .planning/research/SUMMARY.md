# Project Research Summary

**Project:** llm-agent-console
**Domain:** Internal admin/ops console (developer dashboard) + thin single-origin Go BFF over 3 fixed backends (memory-gateway, flowd, customer-support chat), SSE-centric UX
**Researched:** 2026-06-03
**Confidence:** HIGH

## Executive Summary

This is an **internal operator/ops console** — not a consumer product — that fronts three existing headless Go services (memory-gateway, flowd, customer-support chat) with one unified browser UI behind a thin single-origin BFF. Experts build this class of tool as a **client-only React + Vite SPA + a thin proxy-only Go `httputil.ReverseProxy` BFF in this repo**, *not* as a JS meta-framework (Next.js/TanStack Start). *(updated 2026-06-03: packaging is proxy-only BFF + fronting nginx, NOT a `go:embed` single binary — see Architecture Approach.)* Single origin is preserved by a **fronting static host (nginx)** that serves the built SPA at `/` and reverse-proxies `/api/*` to the BFF. All four research tracks converged on the BFF/stack choice: the three backends are already Go, the proxy logic is ~100 lines, Go auto-flushes `text/event-stream` correctly, and there is no SSR/SEO need. The recommended frontend stack is React 19 + TanStack Router + TanStack Query + shadcn/ui + Tailwind v4, with TypeScript pinned to 5.9.x (avoid the just-released 6.0).

The **load-bearing technical constraint** that shapes the entire project: the two streaming endpoints (`POST /flows/{id}/run/stream`, `POST /chat/stream`, plus `POST /runs/{id}/replay`) are **SSE-over-POST**. Native browser `EventSource` is GET-only and cannot send a body or headers, so it is unusable — the browser **must** use a fetch-stream client (`@microsoft/fetch-event-source`, republished and maintained again as of 2026-04). One shared SSE event-timeline renderer should be built once and feed flow-run, replay, and chat. The REST CRUD (memory lifecycle, flow CRUD, history) goes through TanStack Query's cache; the SSE streams are driven imperatively and bridged to the cache only via invalidation at terminal events.

The **#1 risk** is SSE buffering: every layer between the backend and the browser (the BFF's own framework, nginx/LB, gzip middleware) buffers by default and silently degrades the console's core value into "spinner, then everything at once." This must be de-risked first: prove unbuffered streaming through a *real* proxy with compression on as an explicit acceptance gate (`curl -N` + browser). *(updated 2026-06-03: no BFF heartbeat.)* Idle-timeout survival rides on a **raised nginx `proxy_read_timeout`** on SSE locations (the BFF is a pure `httputil.ReverseProxy` pass-through and cannot inject keepalives; flowd/chat emit none), plus the browser client's reconnect and flowd's `/replay`. Both backends already emit a terminal `done`/`flow_done` event so clients stop reconnecting — keep relying on it. The other foundational invariants are an auth boundary that **never leaks the flowd bearer to the browser** and **strips inbound client scope headers + the inbound `Authorization`** then re-materializes the gateway `X-Tenant-Id`/`X-User-Id` server-side from the browser's `X-Console-*` values, plus **allowlisted mapped routes** (no SSRF/pass-through). The recommended build order is vertical slices — foundation → Memory (REST-only, de-risks auth before SSE) → Flow (introduces SSE) → Chat (reuses SSE) → health/errors → compose deploy.

## Key Findings

### Recommended Stack

Build a **client-only React 19 + Vite SPA** served as static assets behind a **thin Go `net/http/httputil.ReverseProxy` BFF in this repo**. Reject the meta-framework "free BFF" — it is a liability here, not a gift, because the auth-injection + multi-backend routing is trivial in Go (the backends are already Go), Go's reverse proxy auto-flushes `text/event-stream` correctly (Next.js App Router has documented SSE buffering pitfalls), and SSR/SEO is wasted on an internal tool. The decisive point: streams are POST, so a fetch-stream client is mandatory on the browser regardless of framework — removing the only reason an isomorphic-streaming framework would help.

**Core technologies:**
- **React 19.2.x + Vite 8.x**: SPA UI + build/dev — internal-tooling default; sub-second HMR; static deploy-anywhere output; required by current shadcn/TanStack.
- **Go 1.23+ `httputil.ReverseProxy` (this repo)**: BFF/reverse proxy — ecosystem-native; auto-flushes `text/event-stream`; trivial per-backend server-side auth injection via the `Rewrite` hook.
- **TanStack Query 5.x + TanStack Router 1.170.x**: server-state cache + type-safe routing — standard for REST admin UIs; loader prefetch pairs natively; **SSE streams bypass the cache**.
- **shadcn/ui (CLI 3.x) + Tailwind v4 (`@tailwindcss/vite`)**: owned components on Radix; best polish/control for an internal console.
- **@microsoft/fetch-event-source 2.0.1**: SSE-over-POST client — **mandatory** (EventSource can't POST); republished/maintained again 2026-04-23.
- **TypeScript pinned 5.9.x** (NOT 6.0.x): let the shadcn/Vite/TanStack/eslint type ecosystem catch up to the major bump.
- Supporting: `@tanstack/react-table`, `react-hook-form` + `zod`, `sonner` (toasts), `lucide-react`; Vitest + Testing Library; Go `httptest` for SSE pass-through tests.

### Expected Features

This is an **operator tool**: operators forgive ugliness but not *blindness*. The cardinal sin is **silent failure** — so "table stakes" is dominated by legibility of state and outcome (loading/empty/error states, raw-response access, request correlation), not polish. Three service clusters drive v1: memory browser + lifecycle editor, live SSE flow-run viewer, streaming chat — plus the shared shell that makes them usable.

**Must have (table stakes):**
- **Shared shell** — nav across 3 consoles, always-visible health dots, active env display, active tenant/user context display.
- **BFF with verified SSE pass-through** + server-side auth injection — without it nothing streams and memory auth fails.
- **Cross-cutting primitives** — loading/empty/error states (highest-leverage table stake), toasts, raw JSON viewer, copyable IDs.
- **Tenant/user context entry + header injection** — memory console is *dead* without it (gateway rejects calls lacking `X-Tenant-Id`/`X-User-Id`).
- **Memory console** — recall/search → item detail → lifecycle actions (write/patch/pin/disable/delete) with confirm on destructive.
- **Flow console** — list → JSON-edit detail/CRUD → trigger run → **live SSE run viewer** → run history → event browse/replay.
- **Chat console** — streaming chat panel (agent steps) with session continuity + sync `/chat` fallback.
- **Service health indicators** — polled per service; colored dot + last-checked. *(updated 2026-06-03: flowd/chat expose `/healthz`/`/readyz`, but memory-gateway exposes only `/metrics` — so "memory healthy" = transport reachability via a cheap probe, e.g. a `/metrics` scrape, NOT a non-existent `/healthz`.)*

**Should have (competitive, v1.x):**
- Command palette / keyboard nav (⌘K to jump services/runs/ids) — power-operator speed.
- Top-line gateway `/metrics` view (capped, NOT a dashboard) — health beyond up/down without Grafana.
- SSE auto-reconnect + `/events` backfill — for long flows on flaky networks (verify flowd resume support first).
- Dark mode; session close/heartbeat action surfacing.

**Defer / anti-features (keep OUT of v1):**
- **Graphical drag-and-drop DAG/flow editor** — large; explicitly deferred; prove read/run path first (v1 edits flow JSON).
- **Full metrics dashboards/charts** — Grafana already ships in the compose stack; link out, don't rebuild.
- **Per-end-user login / RBAC / user management** — internal tool; auth lives at the BFF/ingress.
- **WebSockets** — backends speak SSE (server→client); don't add a second transport.
- **Optimistic UI on destructive actions**, bulk lifecycle ops, client-side run simulation, WYSIWYG memory editor.

### Architecture Approach

The canonical **BFF / single-origin reverse-proxy** topology: one SPA + one BFF process under one origin, the BFF fanning out to three upstreams and injecting each one's distinct auth server-side. *(updated 2026-06-03: single origin is provided by a fronting nginx that serves the SPA and proxies `/api/*` to a proxy-only BFF — NOT a `go:embed` single binary; the BFF serves no static assets.)* The only non-standard wrinkle is SSE-over-POST on two of three upstreams, which constrains both runtime and client. Recommended layout (proxy-only Go BFF + separately-hosted SPA): `cmd/console`, `internal/proxy/{memory,flow,chat,sse}.go` (one director per upstream — explicit, auditable auth boundaries), `internal/router` + `health` + `config`, and a `web/` SPA (`features/{memory,flow,chat}`, `lib/api.ts` REST + `lib/sse.ts` SSE-over-POST kept separate) built and served by nginx.

**Major components:**
1. **Per-service proxy directors** (one per upstream) — rewrite path, pin upstream base URL, strip client auth/scope headers, inject correct server-side credential (gateway `X-Tenant`/`X-User`; flowd `Bearer FLOWD_TOKEN`; chat none).
2. **SSE pass-through** — forward `text/event-stream` unbuffered, flush per chunk, long-lived, cancel upstream on client disconnect; Go auto-flushes so it needs ~zero tuning *as long as* no compression/buffering middleware wraps stream routes.
3. **SPA shell, served by the fronting nginx** — *(updated 2026-06-03: the SPA is built and served by nginx with `index.html` fallback, NOT `go:embed`'d into the BFF; the BFF serves no static assets.)* shell owns nav + operator-context provider that feeds the `X-Console-*` headers the BFF re-materializes into gateway scope headers.
4. **Area views with two data paths** — REST→TanStack Query cache (CRUD/history); SSE→imperative subscription updating local view state, invalidating the cache only at stream terminal events.
5. **Health/observability surface** — fan-out of upstream `/healthz`/`/readyz` + read-only `/metrics` passthrough.

### Critical Pitfalls

1. **SSE buffered/broken by the proxy layer (the #1 failure)** — every layer buffers by default; often works on localhost, breaks behind a real proxy. Avoid: per-event `Flush()`; set `X-Accel-Buffering: no` + `Cache-Control: no-cache, no-transform`; **disable gzip on SSE routes**; nginx `proxy_buffering off`. Acceptance gate: `curl -N` *and* browser stream live through a real proxy with compression on.
2. **Idle/proxy timeouts kill long streams** — quiet runs severed at ~30/60s. Avoid: *(updated 2026-06-03: no BFF heartbeat — pure pass-through; flowd/chat emit none)* a **raised nginx `proxy_read_timeout`** (e.g. ≥1h) on SSE locations + client reconnect + flowd `/replay`; disable global WriteTimeout on BFF stream routes.
3. **Leaking the flowd bearer (and gateway scope) to the browser** — collapses the whole security model. Avoid: token in BFF env only, injected on the upstream hop; *(updated 2026-06-03)* browser→BFF auth via the app-layer shared operator token (`Authorization: Bearer`, in-memory — fetch-event-source can set headers since streams are POST), NOT a cookie; grep gate on bundle/responses/logs; never put any token in an SSE URL.
4. **Confused-deputy / SSRF + header-scope spoofing** — gateway trusts `X-Tenant-Id`/`X-User-Id` with no other auth. Avoid: **allowlist explicit mapped routes** (never pass-through to a client-supplied target); *(updated 2026-06-03)* **strip inbound `X-*-Id` + `Authorization`** and re-materialize gateway scope server-side from the browser's `X-Console-*` values; pin upstream hosts.
5. **Late joiners lose events / replay not wired** — flowd's replay is a **separate endpoint, not `Last-Event-ID`**. Avoid: hydrate from `GET /runs/{id}/events` then attach live, dedupe by event id; on reconnect prefer `/replay`. (Chat has no replay — persisted turns authoritative, streaming delta ephemeral.)
6. **Poor empty/error/loading/disconnected states (ops-tool trust killer)** + unbounded DOM growth on long streams + REST/SSE races + optimistic-CRUD desync — design five explicit states per view; virtualize/bound stream logs; reconcile snapshot-then-stream by sequence; reconcile/rollback CRUD against the gateway response.

## Implications for Roadmap

Build **vertical slices** — one service end-to-end before the next — so the BFF skeleton, single-origin co-deploy, and frontend shell are proven on the simplest slice first. The deliberate ordering decision: **Memory (REST-only) before Flow (first SSE)** to de-risk auth injection + operator context + REST cache *before* tackling the project's keystone SSE risk.

### Phase 1: Foundation — BFF skeleton + shell + operator/tenant context
**Rationale:** Everything hangs on the single-origin BFF and the auth boundary; these invariants (no secret to browser, strip client scope, allowlist routes) must be correct from day one.
**Delivers:** Config loader (3 base URLs + flowd secret, fail-fast); route-namespacing router with **allowlisted mapped routes**; static SPA serving + `index.html` fallback; own `/healthz`; SPA shell with nav placeholders + operator-context provider (tenant/user/session/project).
**Addresses:** Shared shell, BFF auth-injection scaffolding, tenant/user context entry.
**Avoids:** Pitfall 3 (token leak — grep gate), Pitfall 4 (SSRF/header-spoof — allowlist + strip-and-set server-side).

### Phase 2: Memory console — REST-only (proves auth injection + cache)
**Rationale:** No SSE = lowest risk; validates the memory director's `X-Tenant`/`X-User` injection, operator context, and the TanStack Query cache before any streaming.
**Delivers:** Memory proxy director; REST client + query cache; recall/search → item detail → lifecycle actions (write/patch/pin/disable/delete with confirm on destructive).
**Uses:** TanStack Query/Router, react-hook-form + zod, shadcn tables/dialogs.
**Implements:** Per-service director + REST data path. **Establishes the five-state (loading/empty/error/...) pattern.**
**Avoids:** Pitfall 9 (optimistic CRUD desync — reconcile/rollback/refetch), Pitfall 6 (re-verify scope-header stripping where gateway auth is exercised).

### Phase 3: Flow console — REST + first SSE (proves streaming pass-through)
**Rationale:** Introduces the load-bearing SSE-through-BFF mechanics on a service that *also* has REST, establishing the hybrid pattern. This is the project's highest-risk phase.
**Delivers:** Flow director (inject `Bearer FLOWD_TOKEN`); **SSE route wired unbuffered (pure pass-through, no BFF heartbeat) + ctx cancellation**, with idle survival via the raised nginx `proxy_read_timeout`; `@microsoft/fetch-event-source` client; **shared SSE event-timeline renderer**; flow CRUD; live run viewer; run history + `/events` browse + `/replay`; invalidate runs list on completion. *(updated 2026-06-03)*
**Uses:** fetch-event-source, JSON editor (Monaco/CodeMirror), virtualized list.
**Implements:** SSE pass-through + browser fetch-stream + REST/SSE reconciliation.
**Avoids:** Pitfalls 1 & 2 (buffering, idle timeout — *acceptance gate before any flow UI*), 4 (hydrate-then-stream + dedupe), 7 (virtualize logs), 8 (snapshot-then-stream by sequence).

### Phase 4: Chat console — SSE-first (reuses streaming infra)
**Rationale:** Depends entirely on the streaming infra proven in Phase 3; smallest new surface.
**Delivers:** Chat director (no auth); reuse SSE client + pass-through for `POST /chat/stream`; session continuity; sync `/chat` fallback; reuse timeline renderer for agent steps.
**Avoids:** Pitfall 7 (reuse bounded/virtualized log component), respect upstream IP rate limits.

### Phase 5: Health/observability + error-state hardening
**Rationale:** Health needs all three upstreams wired; error/disconnected surfaces harden the proven happy paths.
**Delivers:** Fan-out `/healthz`/`/readyz` + read-only `/metrics` passthrough; per-area error/empty/disconnected states; stream connection-status UI + manual retry + client reconnect backoff/cap.
**Avoids:** Pitfall 10 (five distinct states enforced), reconnect-storm (client backoff + `close()` on terminal `done`).

### Phase 6: Deploy — compose service
**Rationale:** Long-lived process(es) as compose service(s) in the umbrella stack — **not serverless/edge** (execution limits + buffering break long streams). *(updated 2026-06-03: a proxy-only Go BFF + a fronting nginx serving the SPA, NOT a single Go binary with embedded SPA.)*
**Delivers:** Compose service(s) alongside existing stack — proxy-only Go BFF + fronting nginx; ensure the fronting nginx does not buffer/gzip and does not idle-timeout the SSE routes under `/api/*` (`proxy_buffering off`, gzip off, raised `proxy_read_timeout`); document required LB idle-timeout. *(updated 2026-06-03: SSE rides the same `/api/*` prefix — no separate `/stream/*` top-level prefix.)*

### Phase Ordering Rationale
- **Dependency chain:** foundation → memory → flow [adds SSE] → chat [reuses SSE] → health/errors → deploy. Each slice ships a usable operator capability.
- **De-risk auth before streaming:** Memory (REST-only) deliberately precedes Flow so auth injection + context + cache are proven before the keystone SSE risk.
- **Build SSE infra once:** the fetch-stream client, BFF pass-through, and event-timeline renderer are built in Phase 3 and reused by Phase 4 — avoids triplicate work.
- **Avoids scope creep:** no DAG editor or metrics-dashboard phases in v1 (Grafana ships already; link out).

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Flow/SSE):** Highest-risk phase. Needs concrete BFF SSE-flush hardening + replay/dedupe design verified against the *actual* deploy proxy. *(updated 2026-06-03: the heartbeat question is ANSWERED — flowd/chat emit none and the BFF injects none; idle survival is the raised nginx `proxy_read_timeout`.)* The open item is verifying that `proxy_read_timeout`/LB idle-timeout covers the longest silent step, and that flowd resume is the *separate* `/replay` endpoint (not `Last-Event-ID`) — `/gsd:plan-phase --research-phase` recommended.
- **Phase 6 (Deploy):** Verify the umbrella's fronting proxy/LB config (buffering, idle timeout, gzip) against SSE routes — environment-specific, not in current research.

Phases with standard, well-documented patterns (skip research-phase):
- **Phase 1 (Foundation):** Go `httputil.ReverseProxy` + static serving is well-documented; auth-injection pattern is verified HIGH.
- **Phase 2 (Memory/REST):** Standard TanStack Query CRUD over a reverse proxy.
- **Phase 4 (Chat):** Reuses Phase 3 infra; minimal new surface.
- **Phase 5 (Health):** Trivial fan-out + Prometheus-text parsing.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified against npm registry on 2026-06-03; Go SSE auto-flush verified against stdlib docs + golang/go #47359; meta-framework tradeoff cross-checked vs Next.js streaming docs. |
| Features | HIGH | Routes/auth/constraints from verified PROJECT.md route code; UI patterns from ecosystem convention + current SSE sources (MEDIUM on UI-pattern specifics). |
| Architecture | HIGH | BFF/SSE constraints verified against Go stdlib + multiple proxy-buffering sources; frontend layout specifics MEDIUM (stack-dependent). |
| Pitfalls | HIGH | SSE-proxy + EventSource semantics verified against MDN/WHATWG + 2025-2026 production guides; BFF/auth pitfalls are well-established. |

**Overall confidence:** HIGH

### Gaps to Address
- **Backend SSE behavior** *(updated 2026-06-03: heartbeat question ANSWERED)*: flowd (`writeSSE`) and chat (`writeSSE`) emit `event:`/`data:` frames only — **no heartbeat, no `retry:`, no `id:`** — and the BFF is a pure pass-through that injects none, so idle survival rides on the raised nginx `proxy_read_timeout` (no BFF-injected heartbeat). Still verify during Phase 3 that flowd resume is the *separate* `/replay` endpoint (not `Last-Event-ID`); default to `/replay` + `/events`-backfill + dedupe.
- **Deploy proxy config unverified:** The umbrella's fronting proxy/LB buffering, gzip, and idle-timeout behavior aren't in research. → Make the unbuffered-through-real-proxy test an explicit Phase 3 acceptance gate and re-verify in Phase 6.
- **Operator auth on the BFF itself** *(updated 2026-06-03: DECIDED)*: an **app-layer shared operator token** sent by the browser as `Authorization: Bearer` (held in memory, not `localStorage`; empty config = disabled in dev), authenticated and consumed by the BFF — NOT a cookie. fetch-event-source can set the header since the streams are POST, so browser→BFF auth works without exposing the flowd token. The fronting nginx stays proxy-only (no auth).
- **`@microsoft/fetch-event-source` longevity:** version string still 2.0.1 but republished 2026-04; `@fortaine` fork is the fallback. → Low risk; revisit only if a needed fix is missing.

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view` / `time.modified`), 2026-06-03 — verified versions for vite, react, @tanstack/*, tailwindcss, typescript (avoid 6.0), @microsoft/fetch-event-source.
- Go `net/http/httputil.ReverseProxy` docs + golang/go #47359, #27816, #41642 — auto `FlushInterval=-1` for `text/event-stream`; streaming behavior.
- MDN "Using server-sent events" / EventSource + WHATWG HTML #2177 — EventSource is GET-only, cannot set headers/body.
- Context7 — `/vitejs/vite`, `/tanstack/query`, `/reactjs/react.dev`, `/shadcn-ui/ui`, `/remix-run/react-router`.
- Verified PROJECT.md route inventory — three backends, auth models, explicit Out-of-Scope (DAG editor, Grafana replacement).

### Secondary (MEDIUM confidence)
- Next.js/Vercel SSE streaming + serverless/edge buffering & timeout discussions (#48427) — App Router SSE pitfalls, `X-Accel-Buffering: no`, disable compression.
- OneUptime / CodeToDeploy / gin #1589 — nginx `proxy_buffering off`, gzip-off, timeout defaults that break SSE.
- SSE-over-POST via fetch + ReadableStream writeups; tkdodo/TanStack — keep SSE out of the query cache, invalidate at boundaries.
- React UI library comparisons (shadcn vs Mantine vs Radix); SSE UI patterns (GitHub/Vercel/Stripe log streams); admin-panel feature conventions (Refine, WeWeb).

### Tertiary (LOW confidence)
- (None load-bearing — backend-specific SSE/heartbeat/resume behavior is a *gap to verify*, not a low-confidence source.)

---
*Research completed: 2026-06-03*
*Updated 2026-06-03: packaging = proxy-only BFF + fronting nginx (not `go:embed`); auth = `X-Console-*` headers + app-layer shared token (not cookie); SSE = pure pass-through, no BFF heartbeat (raised nginx `proxy_read_timeout` instead); SSE rides the `/api/*` prefix (no `/stream/*`).*
*Ready for roadmap: yes*
