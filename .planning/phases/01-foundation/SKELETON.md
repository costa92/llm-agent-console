# Walking Skeleton — llm-agent-console

**Phase:** 1
**Generated:** 2026-06-03

## Capability Proven End-to-End

An operator can load the console from a single origin (nginx fronting proxy), navigate between Memory/Flow/Chat placeholders in the shell, set tenant/user operator context that persists across reloads, and watch a synthetic `GET /api/stream/test` SSE stream emit timestamped events incrementally — proving unbuffered flush through the real fronting proxy with compression on, one tick per second, not all-at-once at the end.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| BFF | Go `httputil.ReverseProxy` (proxy-only, no `go:embed`) | Ecosystem-native (3 Go backends); auto-flush on `text/event-stream`; `Rewrite` hook for auth injection; zero streaming caveats vs. JS runtimes |
| SPA | React 19 + Vite 8.x + TypeScript 5.9.3 (pinned, NOT 6.x) | SPA-native build tool; sub-second HMR; dev proxy mirrors prod nginx routing; static output served by nginx |
| Routing | TanStack Router 1.170.x | Type-safe routes; layout routes for shell; search-param state for later phases |
| Data fetching | TanStack Query 5.101.x (REST only); `@microsoft/fetch-event-source` (SSE-over-POST) | TanStack Query for REST cache/dedupe; `@microsoft/fetch-event-source` mandatory because both stream endpoints are POST (native EventSource is GET-only) |
| UI components | shadcn/ui CLI 3.x on Radix + Tailwind v4 | Copy-in components (owned code); Radix accessibility primitives; React 19 + Tailwind v4 supported |
| Styling | Tailwind CSS v4 with `@tailwindcss/vite` plugin | v4 engine: `@import "tailwindcss"` in CSS, no `tailwind.config.js` needed; PostCSS config is the v3 pattern — do NOT use it |
| Single-origin | nginx serves SPA at `/` AND proxies `/api/*` to BFF (NOT BFF `go:embed`) | D-04/D-05: proxy-only BFF; nginx is the mandatory buffering surface for SSE; one origin without CORS |
| SSE anti-buffering | nginx SSE location: `proxy_buffering off; gzip off; proxy_http_version 1.1; proxy_read_timeout 3600s` + BFF `ModifyResponse` sets `X-Accel-Buffering: no` | D-06 hard constraint: nginx always in front; BFF is a pure pass-through that CANNOT inject keepalives; idle survival via raised `proxy_read_timeout` |
| Auth (BFF app layer) | Optional shared operator token in memory (constant-time byte-XOR); empty config = disabled in dev | D-01: no cookie session, no per-user RBAC, no login flow in v1 |
| Upstream auth injection | `Rewrite` hook per director: strip all `X-*-Id` + `Authorization`; re-materialize gateway scope from `X-Console-*`; inject flowd bearer from config | D-02: never forward browser-set scope headers; flowd token lives only in BFF config, never in SPA bundle/response/log |
| Config | YAML config file (primary) + env-var override for secrets | D-02/D-03: committed `config.dev.yaml` pointing at compose stack |
| Dev loop | Vite dev server proxies `/api/*` → local BFF on `:8090` | Mirrors prod nginx routing; single-origin shape in dev |
| Operator context | `localStorage` for non-secret tenant/user/project/session; sent as `X-Console-*` headers | D-07: only non-secret context in storage; operator token held in memory only |
| SSE client pattern | `web/src/lib/sse.ts` — typed `openSseStream` wrapper around `@microsoft/fetch-event-source`; stubbed (not consumed) in Phase 1 | Both stream endpoints are POST (native `EventSource` is GET-only); wrapper established once in Phase 1 so Phases 3 and 4 inherit the pattern without re-inventing it |
| Directory layout | `cmd/console/` (BFF main), `internal/{config,proxy,router}/` (BFF logic), `web/` (SPA source), `config/` (YAML), `deploy/` (nginx + docker-compose), `scripts/` (BFF-03 proof script) | Per RESEARCH.md recommended structure |
| Go module | `github.com/costa92/llm-agent-console` | Sibling repo under umbrella; standalone git history |

## Stack Touched in Phase 1

- [x] Project scaffold — Go `go.mod` + BFF `cmd/console/main.go`; Vite + React 19 + TypeScript 5.9.3 SPA in `web/`; ESLint flat config; Vitest 4.1.8 + @testing-library/react; Go `httptest` scaffold
- [x] Routing — TanStack Router root layout + three placeholder routes (`/memory`, `/flow`, `/chat`)
- [x] API / BFF — `GET /api/stream/test` synthetic SSE endpoint; `GET /api/config/env`; `/healthz`; three upstream directors (memory/flow/chat) with allowlisted routes; app-layer operator token middleware
- [x] UI — shell (nav + operator-context bar + env indicator + health dots); five-state/toast/raw-JSON viewer/copyable-id primitives; one real proxied call (`GET /api/memory/items/{id}`) to prove auth boundary
- [x] Deployment / dev stack — nginx config (SSE location + general API proxy + SPA fallback); `deploy/docker-compose.yml`; `config.dev.yaml`; Vite dev proxy to BFF; `scripts/sse-proof.sh` (BFF-03 keystone: direct-BFF + through-nginx both proven)
- [x] SSE client stub — `web/src/lib/sse.ts` typed `openSseStream` wrapper (stubbed, not consumed in Phase 1; consumed by Phase 3 flow SSE and Phase 4 chat SSE)

## Out of Scope (Deferred to Later Slices)

- Per-service feature screens: Memory list/detail/write/patch/pin/delete (Phase 2), Flow CRUD/runs/SSE timeline (Phase 3), Chat streaming (Phase 4)
- Live health polling and per-service health state (SHELL-02 — Phase 5); Phase 1 ships only the health dot visual contract with `unknown` initial state
- `web/src/lib/sse.ts` is stubbed in Phase 1; first consumption is in Phase 3 flow SSE (POST `/api/flow/*/run/stream`)
- Auth injection on the stream hop + upstream-heartbeat-absence + replay semantics (BFF-03 proof split; these are proven in Phase 3 against real flowd)
- Operator "recent contexts" quick-select (deferred to v1.x per D-07)
- Single-binary `go:embed` packaging (explicitly NOT chosen per D-04)
- Env-var-first configuration (not chosen per D-02)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: Memory Console — operator searches, inspects, and manages memory items via REST with auth injection proven end-to-end
- Phase 3: Flow Console — operator manages flows and watches a live SSE run timeline (keystone streaming phase against real flowd); consumes `web/src/lib/sse.ts`
- Phase 4: Chat Console — operator drives streaming chat sessions, reusing Phase 3 SSE infra and `web/src/lib/sse.ts`
- Phase 5: Health & Hardening — always-visible per-service health polling + five-state/reconnect hardening across all views
- Phase 6: Deploy — compose service with nginx + BFF serving a full stack with streaming verified end-to-end
