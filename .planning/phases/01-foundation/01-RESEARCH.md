# Phase 1: Foundation - Research

**Researched:** 2026-06-03
**Domain:** Go `httputil.ReverseProxy` BFF + React 19 + Vite SPA + nginx fronting + SSE pass-through
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** App-layer shared operator token + `X-Console-*` scope headers (no cookie). Browser sends optional token as `Authorization: Bearer` to BFF; BFF authenticates at the app layer (empty config = disabled in dev). Token is held in memory only, never in `localStorage`.
- **D-02:** BFF configured by a config file (YAML preferred; planner may choose JSON). Env vars may override secrets but the file is primary.
- **D-03:** A committed local-dev sample config points at the compose stack: gateway `http://localhost:8080`, flowd `http://localhost:7861`, chat `http://localhost:8081`.
- **D-04:** Proxy-only BFF — BFF does NOT embed the SPA (no `go:embed` single-binary). SPA is built separately and served by a fronting static host (nginx).
- **D-05:** Single origin is preserved by the fronting host (nginx serves SPA at `/` AND proxies `/api/*` to the BFF).
- **D-06 (hard constraint):** SSE-buffering hardening at nginx is MANDATORY. On SSE locations: `proxy_buffering off; gzip off; proxy_http_version 1.1;`, pass `X-Accel-Buffering: no` + `Cache-Control: no-cache, no-transform`, raised `proxy_read_timeout` (e.g. ≥1h). BFF is a pure pass-through — injects NO heartbeat. Idle-timeout survival handled at the fronting nginx via raised `proxy_read_timeout`.
- **D-07:** Persistent operator-context bar with inline edit (click → popover). Values sent as `X-Console-Tenant`/`X-Console-User`/`X-Console-Project`/`X-Console-Session`. Only non-secret context is remembered in `localStorage`.
- **BFF-03 proof split:** Phase 1 proves transport end-to-end THROUGH the fronting proxy (synthetic test-stream endpoint allowed). Auth injection on stream + replay are proven in Phase 3.

### Claude's Discretion

- Config file format (YAML vs JSON) — YAML preferred (comments); planner decides.
- The API route prefix and per-service namespacing (e.g. `/api/memory/*`, `/api/flow/*`, `/api/chat/*`).
- The exact SSE-proof mechanism for BFF-03 (synthetic test-stream endpoint in the BFF vs proxying a real flowd run) — MUST run through the fronting proxy per D-06.

### Deferred Ideas (OUT OF SCOPE)

- "Recent contexts" quick-select in the operator-context bar — v1.x.
- Single-binary `go:embed` packaging — explicitly NOT chosen.
- Env-var-first configuration — not chosen.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BFF-01 | Operator reaches all three backends through one origin; allowlisted routes, no SSRF | Per-upstream director pattern; allowlist routes; `r.SetURL()` pins upstream host |
| BFF-02 | BFF injects each service's auth server-side; strips inbound `X-*-Id` + `Authorization`; re-materializes gateway scope from `X-Console-*`; never exposes flowd token | Confirmed from authz/scope.go + auth.go source; full strip+re-materialize pattern documented |
| BFF-03 | BFF proxies SSE responses unbuffered — flush per event, no gzip on text/event-stream, long read timeout, X-Accel-Buffering: no — verified end-to-end through real fronting proxy | Synthetic /api/stream/test endpoint; curl -N + browser assertion; nginx SSE directives |
| BFF-04 | BFF passes through upstream status codes and error bodies | ReverseProxy pass-through by default; ModifyResponse hook if needed |
| SHELL-01 | Operator navigates between Memory/Flow/Chat consoles from persistent shell/nav | TanStack Router layout route + nav bar; placeholder routes for Phase 2-4 |
| SHELL-03 | Operator sets and sees active operator context (tenant/user/optional project/session), persisted across reloads | Operator-context bar component + localStorage persistence; `X-Console-*` header injection wrapper |
| SHELL-04 | Active environment/endpoint the BFF targets displayed prominently | Env indicator in top bar; config endpoint on BFF exposing safe non-secret env name |
| SHELL-05 | Every list/detail/stream view renders explicit loading, empty, and error states | Five-state primitive component pattern; cross-cutting reusable component |
| SHELL-06 | Operator gets toast feedback for every write/lifecycle/run action | sonner integration; success (auto-dismiss) + error (persist with upstream detail) |
| SHELL-07 | Operator can view raw JSON of any item/event/response; copy resource ids with one click | RawJsonViewer component (collapsible, copy-to-clipboard); CopyableId component |
</phase_requirements>

---

## Summary

Phase 1 is a Walking Skeleton: the thinnest end-to-end slice proving the spine of the entire system. The Go BFF is a proxy-only `httputil.ReverseProxy` with one director per upstream — no embedded SPA, no heartbeat injection, no buffering on SSE routes. The fronting nginx provides single-origin by serving the built SPA at `/` and proxying `/api/*` to the BFF, and is the mandatory layer where SSE buffering is killed. The React 19 + Vite SPA provides the shell primitives that all later phases reuse.

The keystone acceptance gate (BFF-03) is a synthetic `text/event-stream` endpoint in the BFF that emits timestamped events on a timer, proven through a running nginx with compression on via `curl -N` and in-browser. This gates Phase 3's real flowd stream work and surfaces any proxy-layer buffering before any streaming UI is built.

The riskiest single implementation point is the nginx SSE location configuration: a mis-set `proxy_buffering`, stray gzip, or too-short `proxy_read_timeout` will silently batch the stream — it works on localhost and breaks only through the fronting proxy. Make the synthetic proof the first vertical slice committed.

**Primary recommendation:** Build in this vertical order: (1) BFF skeleton + config loader + `/api/stream/test` synthetic SSE proof through nginx → BFF-03 gate; (2) SPA scaffold + Vite dev proxy; (3) auth boundary (strip+re-materialize) + memory director stub for one real GET proxied call; (4) shell primitives (five-state, toast, raw-JSON viewer, copyable-id, operator-context bar, health-dot visual contract). Never build horizontal layers.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Single-origin enforcement | CDN / Static (nginx) | — | Nginx serves SPA at `/` AND proxies `/api/*` to BFF on same origin. BFF is proxy-only, serves no static assets. |
| SSE anti-buffering hardening | CDN / Static (nginx) | API / Backend (BFF: sets X-Accel-Buffering on responses) | nginx is the mandatory buffering surface. BFF sets `X-Accel-Buffering: no` on responses so even an uncontrolled nginx inherits the hint. |
| Upstream auth injection | API / Backend (BFF) | — | Secret (flowd bearer) lives only in BFF config. Scope headers re-materialized server-side. Never touches browser. |
| Inbound auth strip | API / Backend (BFF) | — | BFF's Rewrite hook strips all `X-*-Id` and `Authorization` before forwarding. |
| Operator context state | Browser / Client (SPA) | — | Tenant/user/project/session are non-secret, stored in localStorage, sent as `X-Console-*` headers on every request. |
| Static asset serving | CDN / Static (nginx) | — | `web/dist/` served by nginx; `index.html` fallback for SPA routing. |
| Config file loading | API / Backend (BFF) | — | YAML config file with 3 upstream URLs + secrets. Fail-fast if missing. |
| Five-state UI primitives | Browser / Client (SPA) | — | Loading/empty/error/partial/ready states owned by SPA components. |
| Toast feedback | Browser / Client (SPA) | — | sonner, app-wide, bottom-right. |
| Raw JSON viewer / copyable-id | Browser / Client (SPA) | — | Client-side collapsible viewer; clipboard API. |
| BFF-03 synthetic SSE proof | API / Backend (BFF) | CDN / Static (nginx) | A `GET /api/stream/test` endpoint emitting timestamped events at 1s intervals. Proven through nginx. |

---

## Standard Stack

### Core — Go BFF

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `net/http/httputil.ReverseProxy` | Go 1.26.0 (stdlib) | Reverse proxy core | Auto-flushes `text/event-stream` immediately; `Rewrite` hook replaces deprecated `Director`; zero deps |
| `gopkg.in/yaml.v3` | (gopkg.in standard) | YAML config parsing | Most widely used Go YAML library; available locally in Go cache |
| `net/http` | Go 1.26.0 (stdlib) | HTTP server and mux | Go 1.22+ ServeMux supports method+path patterns (`POST /api/...`) |

[VERIFIED: go doc net/http/httputil ReverseProxy] — Go 1.26.0 confirmed on this machine; `Rewrite func(*ProxyRequest)` confirmed as current API; `Director` marked deprecated; FlushInterval auto-set for streaming responses confirmed.

### Core — SPA

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19.2.7 | UI library | Stable; required by shadcn CLI 4.x and TanStack |
| Vite | 8.0.16 | Build tool + dev server | SPA-native; sub-second HMR; dev proxy for `/api/*` → local BFF |
| TypeScript | 5.9.3 | Language | Pin to 5.9.3 explicitly (see Version Gotcha below) |
| TanStack Router | 1.170.11 | Routing | Type-safe routes; layout routes for shell; search-param state for later phases |
| TanStack Query | 5.101.0 | REST data fetching + cache | Cache, dedupe, invalidation for REST. SSE bypasses it. |
| Tailwind CSS | 4.3.0 | Styling | v4 engine required by shadcn CLI 4.x; `@import "tailwindcss"` + `@tailwindcss/vite` plugin |
| shadcn CLI | 4.10.0 | UI component kit | Copy-in Radix+Tailwind components; React 19 + Tailwind v4 supported |
| `@tailwindcss/vite` | 4.3.0 | Tailwind v4 Vite integration | Replaces PostCSS config from v3; must match Tailwind version |
| `@microsoft/fetch-event-source` | 2.0.1 | SSE-over-POST client | Required — both SSE endpoints are POST; native EventSource is GET-only |
| sonner | 2.0.7 | Toast system | shadcn's recommended toast; app-wide single instance |
| lucide-react | 1.17.0 | Icons | shadcn default; includes all needed status icons |
| zod | 4.4.3 | Runtime schema validation | Validate BFF responses; flow JSON editor validation in Phase 3 |

[VERIFIED: npm registry 2026-06-03]

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| react-hook-form | 7.77.0 | Forms | Operator-context edit form; memory write/patch in Phase 2 |
| `@tanstack/react-table` | 8.21.3 | Headless tables | Memory lists/run lists in Phase 2-3 — not needed in Phase 1 |
| `@tanstack/react-query-devtools` | 5.101.0 | Dev cache inspector | Dev only |
| Vitest | 4.1.8 | Unit/component tests | Vite-native test runner |
| `@testing-library/react` | 16.3.2 | Component testing | Standard with Vitest |
| `Go net/http + httptest` | stdlib | BFF unit tests | Test SSE pass-through with `httptest.NewServer` emitting `text/event-stream` |

[VERIFIED: npm registry 2026-06-03]

### Version Gotcha: TypeScript

**STACK.md says 5.9.x — the npm `latest` tag is now 6.0.3 (released post-research).** TypeScript 5.9.3 exists on the registry and is installable. Pin explicitly: `"typescript": "5.9.3"` in `package.json`. Do NOT use `npm install typescript` (installs 6.0.3). Use `npm install typescript@5.9.3`.

[VERIFIED: npm view typescript@5.9.3 version — 5.9.3 confirmed on registry, modified 2026-04-16]

### Version Gotcha: shadcn CLI

**STACK.md says CLI 3.x — the npm `latest` is now 4.10.0.** Both support React 19 + Tailwind v4. Use `npx shadcn@latest init` which pulls 4.10.0. Plan tasks should reference `shadcn@4.10.0` not `shadcn@3.x`.

[VERIFIED: npm view shadcn version — 4.10.0, modified 2026-06-01]

### Installation Commands

```bash
# Scaffold SPA (inside web/ subdirectory)
npm create vite@latest . -- --template react-ts

# Tailwind v4
npm install tailwindcss@4.3.0 @tailwindcss/vite@4.3.0

# shadcn init (will ask for style/base-color — use default/zinc for dark theme)
npx shadcn@latest init

# Core routing/data
npm install @tanstack/react-router@1.170.11 @tanstack/react-query@5.101.0

# SSE client (mandatory)
npm install @microsoft/fetch-event-source@2.0.1

# UI primitives
npm install sonner@2.0.7 lucide-react@1.17.0 react-hook-form@7.77.0 zod@4.4.3

# TypeScript — pin to 5.9.3 explicitly
npm install typescript@5.9.3

# Dev tools
npm install -D vitest@4.1.8 @testing-library/react@16.3.2 @tanstack/react-query-devtools@5.101.0

# shadcn components for Phase 1 (from official registry only)
npx shadcn@latest add button card dialog popover input label tooltip badge separator scroll-area collapsible sonner
```

---

## Package Legitimacy Audit

> slopcheck was run but reported all npm packages as SLOP because it defaulted to checking PyPI (Python registry) rather than npm. This is a known cross-ecosystem confusion. The correct verification was performed using `npm view` against the npm registry directly.

| Package | Registry | Age | Downloads approx | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| react 19.2.7 | npm | ~10 yrs | 50M+/wk | github.com/facebook/react | CROSS-ECOSYSTEM (npm, not pypi) | Approved — mega-popular |
| vite 8.0.16 | npm | ~5 yrs | 25M+/wk | github.com/vitejs/vite | CROSS-ECOSYSTEM | Approved |
| tailwindcss 4.3.0 | npm | ~7 yrs | 15M+/wk | github.com/tailwindlabs/tailwindcss | CROSS-ECOSYSTEM | Approved |
| @tailwindcss/vite 4.3.0 | npm | ~1 yr | — | github.com/tailwindlabs/tailwindcss | CROSS-ECOSYSTEM | Approved — official Tailwind Labs repo |
| @tanstack/react-router 1.170.11 | npm | ~3 yrs | — | github.com/TanStack/router | CROSS-ECOSYSTEM | Approved |
| @tanstack/react-query 5.101.0 | npm | ~5 yrs | 8M+/wk | github.com/TanStack/query | CROSS-ECOSYSTEM | Approved |
| @microsoft/fetch-event-source 2.0.1 | npm | ~4 yrs (revived 2026-04-23) | — | github.com/Azure/fetch-event-source | CROSS-ECOSYSTEM | Approved — Azure/Microsoft official; revived April 2026 |
| sonner 2.0.7 | npm | ~3 yrs | — | github.com/emilkowalski/sonner | CROSS-ECOSYSTEM | Approved — author is shadcn team member |
| lucide-react 1.17.0 | npm | ~4 yrs | — | github.com/lucide-icons/lucide | CROSS-ECOSYSTEM | Approved |
| react-hook-form 7.77.0 | npm | ~5 yrs | 5M+/wk | github.com/react-hook-form/react-hook-form | CROSS-ECOSYSTEM | Approved |
| zod 4.4.3 | npm | ~5 yrs | 12M+/wk | github.com/colinhacks/zod | CROSS-ECOSYSTEM | Approved |
| vitest 4.1.8 | npm | ~3 yrs | — | github.com/vitest-dev/vitest | CROSS-ECOSYSTEM | Approved |
| typescript 5.9.3 | npm | ~12 yrs | 50M+/wk | github.com/microsoft/TypeScript | CROSS-ECOSYSTEM | Approved |
| shadcn (CLI) 4.10.0 | npm | ~2 yrs | — | github.com/shadcn-ui/ui | CROSS-ECOSYSTEM | Approved — shadcn official CLI |

**Packages removed due to slopcheck [SLOP] verdict:** none — slopcheck ran against wrong ecosystem (PyPI vs npm); all packages verified directly via `npm view` on npm registry.
**Packages flagged as suspicious [SUS]:** none on npm registry.

*Note: postinstall scripts checked for vite, react, tailwindcss, @tailwindcss/vite, @tanstack/react-router, @tanstack/react-query, @microsoft/fetch-event-source, sonner, vitest — none found.*

---

## Architecture Patterns

### System Architecture Diagram

```
Browser (single origin: https://console.example.com)
│
│  React 19 SPA (served from nginx /web/dist)
│  ┌─────────────────────────────────────────────────────┐
│  │ Shell: nav (Memory/Flow/Chat) + operator-context bar │
│  │ + env indicator + health dots (unknown state init)   │
│  │                                                      │
│  │ TanStack Router layout route                         │
│  │   /memory/* placeholder ← Phase 2                   │
│  │   /flow/* placeholder   ← Phase 3                   │
│  │   /chat/* placeholder   ← Phase 4                   │
│  └─────────────────────────────────────────────────────┘
│
│  Every request: fetch wrapper injects X-Console-Tenant/User/Project/Session
│  SSE streams: @microsoft/fetch-event-source (POST + headers + AbortController)
│  REST: TanStack Query → fetch /api/*
│
▼ same-origin HTTP to nginx
┌─────────────────────────────────────────────────────────┐
│  nginx (fronting host)                                  │
│  location / { try_files $uri /index.html; }  ← SPA     │
│  location /api/ {                            ← BFF proxy│
│    proxy_pass http://bff:8090;                          │
│    proxy_read_timeout 60s;                              │
│  }                                                      │
│  location ~* \.(stream|/stream/) {           ← SSE      │
│    proxy_buffering off;                                 │
│    gzip off;                                            │
│    proxy_http_version 1.1;                              │
│    proxy_read_timeout 3600s;                            │
│    proxy_pass http://bff:8090;                          │
│  }                                                      │
└──────────────────┬──────────────────────────────────────┘
                   │ /api/*
                   ▼
┌─────────────────────────────────────────────────────────┐
│  Go BFF (cmd/console, proxy-only, no static assets)     │
│                                                         │
│  app-layer operator token check (constant-time)         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ route dispatch (Go 1.22 ServeMux patterns)         │  │
│  │   /api/memory/* → memoryDirector                  │  │
│  │   /api/flow/*   → flowDirector                    │  │
│  │   /api/chat/*   → chatDirector                    │  │
│  │   /api/stream/test → synthetic SSE proof endpoint │  │
│  │   /healthz, /api/config/env                       │  │
│  └──────┬───────────────┬──────────────────┬─────────┘  │
│         │               │                  │             │
│  memoryDirector    flowDirector        chatDirector      │
│  Rewrite:          Rewrite:            Rewrite:          │
│  strip X-*-Id      strip inbound       strip inbound     │
│  strip Auth        Authorization       Authorization     │
│  re-materialize    inject Bearer        (no auth)        │
│  X-Tenant-Id       FLOWD_TOKEN                           │
│  X-User-Id         (from config)                         │
│  from X-Console-*                                        │
│         │               │                  │             │
└─────────┼───────────────┼──────────────────┼─────────────┘
          ▼               ▼                  ▼
   memory-gateway      flowd             customer-support
   :8080 REST          :7861 REST+SSE    :8081 SSE+REST
   X-Tenant-Id         Authorization:   (no auth)
   X-User-Id           Bearer <token>
```

### Recommended Project Structure

```
llm-agent-console/
├── cmd/
│   └── console/
│       └── main.go           # load config, wire proxies, start HTTP server
├── internal/
│   ├── config/
│   │   └── config.go         # YAML config struct; load + validate; fail-fast
│   ├── proxy/
│   │   ├── memory.go         # memoryDirector: strip+re-materialize X-*-Id from X-Console-*
│   │   ├── flow.go           # flowDirector: inject Bearer FLOWD_TOKEN; no buffering
│   │   ├── chat.go           # chatDirector: no auth; no buffering
│   │   └── auth.go           # operator token check (constant-time; empty = disabled)
│   └── router/
│       └── router.go         # mount all handlers; /api/* dispatch; /healthz; /api/stream/test
├── web/                      # SPA source (NOT go:embed'd — served by nginx)
│   ├── src/
│   │   ├── main.tsx          # React entry; QueryClientProvider; RouterProvider
│   │   ├── app/
│   │   │   ├── Shell.tsx     # layout: nav + operator-context bar + env indicator + health dots
│   │   │   ├── OperatorContextProvider.tsx   # context + localStorage persistence
│   │   │   └── routes/
│   │   │       ├── __root.tsx                # TanStack Router root layout
│   │   │       ├── memory.tsx               # placeholder
│   │   │       ├── flow.tsx                 # placeholder
│   │   │       └── chat.tsx                 # placeholder
│   │   ├── components/
│   │   │   ├── primitives/
│   │   │   │   ├── FiveStateWrapper.tsx     # loading/empty/error/partial/ready
│   │   │   │   ├── RawJsonViewer.tsx        # collapsible + copy-to-clipboard
│   │   │   │   └── CopyableId.tsx           # mono + hover copy icon + toast
│   │   │   ├── shell/
│   │   │   │   ├── NavBar.tsx               # left nav; active-item blue accent
│   │   │   │   ├── TopBar.tsx               # env indicator + operator-context bar
│   │   │   │   ├── OperatorContextBar.tsx   # tenant/user display + popover edit
│   │   │   │   └── HealthDot.tsx            # 8px dot + status color (unknown init)
│   │   │   └── ui/                          # shadcn copy-in components
│   │   └── lib/
│   │       ├── api.ts         # typed REST fetch wrapper: injects X-Console-* headers
│   │       └── sse.ts         # fetchEventSource wrapper (Phase 1: not used yet)
│   ├── index.html
│   ├── vite.config.ts         # @tailwindcss/vite plugin; dev proxy /api/* → BFF
│   └── tsconfig.json          # strict; target ES2022; "typescript": "5.9.3" pinned
├── config/
│   └── config.dev.yaml        # local-dev sample: gateway:8080, flowd:7861, chat:8081
├── deploy/
│   ├── nginx.conf             # SPA fallback + /api/* proxy + SSE location overrides
│   └── docker-compose.yml     # BFF + nginx + existing 3 services
└── go.mod                     # module github.com/costa92/llm-agent-console
```

---

## Pattern 1: Go BFF `Rewrite` Hook (per-upstream director)

**What:** One `httputil.ReverseProxy` instance per upstream service. Each uses the `Rewrite func(*ProxyRequest)` hook to: set the target URL, strip inbound auth/scope headers, inject the correct service auth. `Director` is deprecated as of Go 1.20 — use `Rewrite`.

**When to use:** Always — three services, three auth models.

**Key Go 1.26 API facts (VERIFIED via `go doc`):**
- `Rewrite func(*ProxyRequest)` — modifies `r.Out` (outbound request); reads `r.In` (inbound, do not modify)
- `r.SetURL(target)` — sets scheme, host, and rewrites path relative to target base
- `r.Out.Header.Del(key)` — removes a header from the outbound request
- `r.Out.Header.Set(key, val)` — sets a header on the outbound request
- `FlushInterval` — auto-set to immediate flush when response is detected as streaming (`Content-Type: text/event-stream` or `ContentLength: -1`); no manual config needed for SSE
- `ModifyResponse func(*http.Response) error` — modify response before forwarding to browser; use to inject `X-Accel-Buffering: no` on SSE responses as a defense-in-depth measure

```go
// Source: go doc net/http/httputil + internal pattern from sibling repos
// memory director — strip inbound scope/auth, re-materialize from X-Console-*
memoryProxy := &httputil.ReverseProxy{
    Rewrite: func(r *httputil.ProxyRequest) {
        r.SetURL(cfg.MemoryBase) // pins upstream host; path is /api/memory/... → /memory/...

        // Strip everything the browser must not control
        r.Out.Header.Del("Authorization")    // operator token is app-layer, not forwarded
        r.Out.Header.Del("X-Tenant-Id")      // never trust client-set scope headers
        r.Out.Header.Del("X-User-Id")
        r.Out.Header.Del("X-Project-Id")
        r.Out.Header.Del("X-Session-Id")

        // Re-materialize from the non-secret X-Console-* values the browser sent
        r.Out.Header.Set("X-Tenant-Id", r.In.Header.Get("X-Console-Tenant"))
        r.Out.Header.Set("X-User-Id", r.In.Header.Get("X-Console-User"))
        if p := r.In.Header.Get("X-Console-Project"); p != "" {
            r.Out.Header.Set("X-Project-Id", p)
        }
        if s := r.In.Header.Get("X-Console-Session"); s != "" {
            r.Out.Header.Set("X-Session-Id", s)
        }
        // Remove X-Console-* so they don't leak into upstream requests
        r.Out.Header.Del("X-Console-Tenant")
        r.Out.Header.Del("X-Console-User")
        r.Out.Header.Del("X-Console-Project")
        r.Out.Header.Del("X-Console-Session")
    },
    // Defense-in-depth: set X-Accel-Buffering: no on SSE responses
    ModifyResponse: func(resp *http.Response) error {
        if strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream") {
            resp.Header.Set("X-Accel-Buffering", "no")
            resp.Header.Set("Cache-Control", "no-cache, no-transform")
        }
        return nil
    },
}

// flow director — inject bearer token server-side
flowProxy := &httputil.ReverseProxy{
    Rewrite: func(r *httputil.ProxyRequest) {
        r.SetURL(cfg.FlowBase)
        r.Out.Header.Del("Authorization")   // strip any client Authorization
        r.Out.Header.Set("Authorization", "Bearer "+cfg.FlowdToken)
        // strip X-Console-* (not relevant for flowd)
        r.Out.Header.Del("X-Console-Tenant")
        r.Out.Header.Del("X-Console-User")
        r.Out.Header.Del("X-Console-Project")
        r.Out.Header.Del("X-Console-Session")
    },
    ModifyResponse: sseBufferingDefense,  // same as above
}

// chat director — no auth
chatProxy := &httputil.ReverseProxy{
    Rewrite: func(r *httputil.ProxyRequest) {
        r.SetURL(cfg.ChatBase)
        r.Out.Header.Del("Authorization")
        r.Out.Header.Del("X-Console-Tenant")
        r.Out.Header.Del("X-Console-User")
        r.Out.Header.Del("X-Console-Project")
        r.Out.Header.Del("X-Console-Session")
    },
    ModifyResponse: sseBufferingDefense,
}
```

**Path rewriting:** `r.SetURL(base)` with base = `http://host:port` rewrites the path by stripping the `/api/{service}` prefix and using the remaining path relative to the base. Example: BFF receives `/api/memory/recall/unified` → strips `/api/memory` prefix → upstream gets `/memory/recall/unified`. Use `http.StripPrefix` before the proxy handler or rewrite the URL in the `Rewrite` hook directly: `r.Out.URL.Path = strings.TrimPrefix(r.In.URL.Path, "/api/memory")`.

---

## Pattern 2: App-Layer Operator Token Check

**What:** The optional shared operator token is checked at the BFF's HTTP layer before dispatch to any proxy. Constant-time comparison. Empty config = disabled (dev mode).

**Source:** Directly modeled on flowd's `BearerTokenAuthenticator` in `cmd/flowd/server/auth.go` (VERIFIED from source).

```go
// Source: confirmed from llm-agent-flow/cmd/flowd/server/auth.go pattern
func middlewareOperatorAuth(token string, next http.Handler) http.Handler {
    if token == "" {
        return next // disabled in dev
    }
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // /healthz bypasses auth (consistent with flowd pattern)
        if r.URL.Path == "/healthz" {
            next.ServeHTTP(w, r)
            return
        }
        hdr := r.Header.Get("Authorization")
        const prefix = "Bearer "
        if !strings.HasPrefix(hdr, prefix) {
            w.Header().Set("WWW-Authenticate", `Bearer realm="llm-console"`)
            http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
            return
        }
        got := strings.TrimPrefix(hdr, prefix)
        // Constant-time comparison
        if len(got) != len(token) {
            http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
            return
        }
        var diff byte
        for i := range got {
            diff |= got[i] ^ token[i]
        }
        if diff != 0 {
            http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

---

## Pattern 3: BFF-03 Synthetic SSE Proof Endpoint

**What:** A `GET /api/stream/test` endpoint in the BFF that emits a timestamped `event: tick` frame every 1 second for N ticks (default 30), then closes. No auth required. Used exclusively for the BFF-03 acceptance gate.

**Why GET, not POST:** The proof is for transport-layer flushing through nginx. A GET is simpler to test with `curl -N` without needing a request body. Since Phase 1 proves transport only (no auth injection on streams until Phase 3), a GET endpoint is appropriate for the synthetic proof.

```go
// Source: pattern adapted from flowd/server/server.go writeSSE + runSSE
func syntheticSSEHandler(w http.ResponseWriter, r *http.Request) {
    flusher, ok := w.(http.Flusher)
    if !ok {
        http.Error(w, "streaming unsupported", http.StatusInternalServerError)
        return
    }
    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache, no-transform")
    w.Header().Set("X-Accel-Buffering", "no")
    w.Header().Set("Connection", "keep-alive")
    w.WriteHeader(http.StatusOK)
    flusher.Flush()

    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    n := 0
    for {
        select {
        case t := <-ticker.C:
            fmt.Fprintf(w, "event: tick\ndata: {\"t\":%d,\"ts\":\"%s\"}\n\n",
                n, t.UTC().Format(time.RFC3339))
            flusher.Flush()
            n++
            if n >= 30 {
                fmt.Fprintf(w, "event: done\ndata: {\"ticks\":30}\n\n")
                flusher.Flush()
                return
            }
        case <-r.Context().Done():
            return // client disconnected
        }
    }
}
```

**BFF-03 acceptance assertion:**

```bash
# Must emit one JSON line per second, NOT all at once at the end:
curl -N https://console.local/api/stream/test
# Expected: one "event: tick / data: {...}" pair per second, visible incrementally

# If all events arrive at once after ~30s → nginx is buffering → CHECK:
# 1. proxy_buffering off on the SSE location
# 2. gzip off on the SSE location  
# 3. X-Accel-Buffering: no in the BFF response headers
```

---

## Pattern 4: nginx Fronting Configuration

**What:** nginx serves the built SPA at `/` (SPA fallback) and proxies `/api/*` to the BFF. SSE paths get their own location block with buffering/gzip disabled and a raised `proxy_read_timeout`.

**Exact nginx SSE directives (VERIFIED approach from PITFALLS.md + OneUptime/Nginx SSE guide):**

```nginx
# Source: confirmed from multiple production nginx+SSE guides + ARCHITECTURE.md D-06
server {
    listen 80;
    server_name _;

    # Serve the built SPA with SPA fallback
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # SSE-specific location (must come before the general /api/ block)
    # Matches routes ending in /stream or containing /stream/
    location ~* ^/api/.*stream {
        proxy_pass http://bff:8090;
        proxy_http_version 1.1;

        # Kill buffering — the critical trio
        proxy_buffering off;
        proxy_cache off;
        gzip off;

        # Pass anti-buffering hints from BFF through
        proxy_pass_header X-Accel-Buffering;

        # Long idle timeout — flowd/chat emit no heartbeat; cover 60+ min runs
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;

        # Header forwarding
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection '';  # no upgrade needed for HTTP/1.1 SSE
    }

    # General BFF proxy
    location /api/ {
        proxy_pass http://bff:8090;
        proxy_http_version 1.1;
        proxy_read_timeout 60s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # BFF healthcheck passthrough (for compose health checks)
    location /healthz {
        proxy_pass http://bff:8090;
    }
}
```

**Key insight on the `/api/stream/test` synthetic endpoint:** The synthetic proof endpoint is a GET at `/api/stream/test`. The nginx SSE location regex `^/api/.*stream` matches it. The planner must verify this regex is correct and does not accidentally match non-SSE paths.

---

## Pattern 5: Vite Dev Server Proxy

**What:** Vite's dev server proxies `/api/*` to the local Go BFF, mirroring the prod nginx routing so dev and prod share the same single-origin shape.

```typescript
// Source: Vite docs — server.proxy configuration
// web/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),  // Tailwind v4: plugin replaces PostCSS config
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8090',  // local Go BFF port
        changeOrigin: true,
        // DO NOT rewrite — BFF expects the /api/* prefix as-is
      },
    },
  },
})
```

**Tailwind v4 CSS entry (NOT the v3 `@tailwind` directives):**

```css
/* web/src/index.css */
@import "tailwindcss";

/* Custom CSS variables for dark theme tokens from UI-SPEC */
:root {
  --background: #0B0E14;
  --foreground: #E6EAF0;
  --card: #151A23;
  --border: #232A36;
  --primary: #3B82F6;
  --destructive: #EF4444;
  --status-up: #22C55E;
  --status-degraded: #F59E0B;
  --status-down: #EF4444;
  --status-unknown: #8A93A3;
  --muted-foreground: #8A93A3;
}
```

---

## Pattern 6: Operator-Context Header Injection Wrapper

**What:** Every REST request from the SPA injects `X-Console-Tenant`/`X-Console-User`/`X-Console-Project`/`X-Console-Session` headers from the operator-context state. This is the shared fetch wrapper that all TanStack Query fetchers use.

```typescript
// Source: CONTEXT.md D-07 + ARCHITECTURE.md operator context flow
// web/src/lib/api.ts
import { useOperatorContext } from '../app/OperatorContextProvider'

// Standalone fetch wrapper (use in QueryFn, not a React hook)
export function makeApiFetcher(ctx: OperatorContext) {
  return async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers)
    if (ctx.tenantId) headers.set('X-Console-Tenant', ctx.tenantId)
    if (ctx.userId)   headers.set('X-Console-User', ctx.userId)
    if (ctx.projectId) headers.set('X-Console-Project', ctx.projectId)
    if (ctx.sessionId) headers.set('X-Console-Session', ctx.sessionId)
    // Note: operator token is NOT added here (it is held in memory separately,
    // not in the context state, and added by a separate auth layer if enabled)
    return fetch(path, { ...init, headers })
  }
}
```

---

## Pattern 7: Five-State Primitive

**What:** A reusable wrapper component implementing loading/empty/error/partial/ready states. Built once in Phase 1, enforced by all later phases.

```typescript
// Source: UI-SPEC.md five-state pattern contract
// web/src/components/primitives/FiveStateWrapper.tsx
type FiveStateProps = {
  loading: boolean
  error?: { status?: number; service?: string; message: string } | null
  empty?: boolean
  partial?: { message: string } | null
  children: React.ReactNode
}

export function FiveStateWrapper({ loading, error, empty, partial, children }: FiveStateProps) {
  if (loading) return <LoadingState />
  if (error)   return <ErrorState status={error.status} service={error.service} message={error.message} />
  if (empty)   return <EmptyState />
  return (
    <>
      {partial && <PartialBanner message={partial.message} />}
      {children}
    </>
  )
}
// LoadingState: loader spin icon + "Loading…" centered
// ErrorState: red alert-circle + "{status} from {service} — {message}" + Retry + raw-JSON disclosure
// EmptyState: icon + heading + body + optional CTA
// PartialBanner: amber alert-triangle + "Showing partial data — {message}"
```

---

## Pattern 8: Verified SSE Wire Format from Reference Implementations

**Confirmed from source** (llm-agent-flow `server.go` + llm-agent-customer-support `httpapi.go`):

**flowd SSE frame format:**
```
event: flow_started
data: {"flow":"<id>"}

event: node_started
data: {"flow":"<id>","node":"<id>","input":{...}}

event: node_finished
data: {"flow":"<id>","node":"<id>","output":{...}}

event: flow_done
data: {"flow":"<id>","outputs":{...}}

event: flow_err
data: {"error":"<message>"}
```
- No `:` heartbeat frames. No `retry:` field. No `id:` field.
- `X-Accel-Buffering: no` is set on the response by flowd itself (confirmed in `runWithStore`).
- `X-Run-ID` header is set by flowd on all stream responses.
- Replay (`POST /runs/{id}/replay`) also emits SSE + sets `X-Replay: true` header.

**chat SSE frame format:**
```
event: step
data: {"kind":"<step-kind>","answer":"<content>"}

event: done
data: {"kind":"done","answer":"<final-answer>"}

event: error
data: {"kind":"error","error":"<message>"}
```
- No `:` heartbeat. No `retry:`. No `id:`.
- `X-Accel-Buffering: no` is NOT set by chat (unlike flowd). The BFF's `ModifyResponse` hook must inject it for chat SSE responses.
- `X-Session-Id` is set in the **response** header by chat (not request).

**Critical implication:** The BFF's `ModifyResponse` hook is needed to inject `X-Accel-Buffering: no` on chat stream responses since the chat service does not set it itself. flowd already sets it; the BFF's hook is defense-in-depth for flowd and required for chat.

---

## Pattern 9: Walking Skeleton — Thinnest Vertical Slice

The single thinnest end-to-end path that proves the spine (for Phase 1's first deliverable):

```
SPA (dev Vite proxy) → nginx → BFF /api/stream/test → timer emits 30 tick events
                              ↑
                         BFF-03 gate: curl -N + browser
                         Events arrive incrementally (1/sec), not all-at-once
                         Proves: nginx not buffering, BFF flushing, SSE headers correct
```

Then:
```
SPA OperatorContextBar → sets X-Console-Tenant + X-Console-User in localStorage
→ fetch /api/memory/items/{id} (any existing memory item in dev compose stack)
→ nginx → BFF /api/memory/* → memoryDirector strips/re-materializes headers
→ memory-gateway returns item JSON
→ SPA RawJsonViewer renders it
                         ↑
                         Proves: auth boundary, header injection, REST proxy, primitives
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE-over-POST client | Custom ReadableStream parser | `@microsoft/fetch-event-source` | Handles event framing, partial frames, reconnect, AbortController; POST + custom headers work |
| Toast system | Custom toast stack | `sonner` (via shadcn) | Stacking, positioning, auto-dismiss, persistence, types already solved |
| Accessible UI components | Custom buttons/dialogs/popovers | `shadcn/ui` (Radix primitives) | Focus trapping, ARIA, keyboard nav; hundreds of person-hours per component |
| Constant-time token comparison | Naive `===` string equality | Byte-by-byte XOR loop (see Pattern 2) | Timing attack on shared secret; flowd uses this pattern |
| YAML config parsing | Custom parser | `gopkg.in/yaml.v3` | Well-tested; handles all YAML edge cases |
| Reverse proxy with streaming | Custom proxy with `io.Copy` | `httputil.ReverseProxy` | Auto-flush on `text/event-stream`; context cancellation propagation; hop-by-hop header stripping |

---

## Common Pitfalls

### Pitfall 1: nginx buffers the synthetic SSE proof (most common Phase 1 failure)

**What goes wrong:** `curl -N /api/stream/test` returns all 30 events at once after ~30s instead of 1/second. BFF-03 gate fails.

**Why it happens:** The nginx SSE location block is misconfigured. Most likely causes in order:
1. `proxy_buffering` not set to `off` on the SSE location (default is `on`)
2. `gzip` not disabled on the SSE location (gzip buffers to compress)
3. SSE location regex doesn't match the `/api/stream/test` path
4. The SSE location block appears AFTER the general `/api/` block and is shadowed by it

**How to avoid:** Put the SSE location block with `~*` regex BEFORE the plain `/api/` location. Verify nginx config with `nginx -t`. Test immediately: `curl -N http://localhost/api/stream/test` while watching with `time`.

**Warning signs:** All events arrive at once; `Content-Encoding: gzip` visible on SSE response; nginx logs show the response completing instantly.

---

### Pitfall 2: `SetURL` rewrites the path incorrectly leaving `/api/memory` prefix intact

**What goes wrong:** `memoryProxy` forwards `/api/memory/recall/unified` to `http://gateway:8080/api/memory/recall/unified` instead of `http://gateway:8080/memory/recall/unified`.

**Why it happens:** `r.SetURL(base)` alone does NOT strip the `/api/memory` prefix. It only sets the host and scheme. The full request path (including `/api/memory`) is preserved unless explicitly rewritten.

**How to avoid:** Either use `http.StripPrefix("/api/memory", memoryProxy)` when registering the handler, OR manually rewrite in the `Rewrite` hook: `r.Out.URL.Path = strings.TrimPrefix(r.In.URL.Path, "/api/memory")`.

**Best approach:** Use `http.StripPrefix` — it keeps the director simple and the path rewriting explicit.

---

### Pitfall 3: TypeScript 6.0 installed instead of 5.9.3

**What goes wrong:** `npm install typescript` installs 6.0.3 (the current `latest`). Various shadcn component code generation and TanStack type utilities have not been tested against 6.0. Build failures or type errors surface mid-implementation.

**How to avoid:** Pin explicitly in `package.json`: `"typescript": "5.9.3"`. In the scaffold command use `npm install typescript@5.9.3`.

---

### Pitfall 4: Tailwind v4 PostCSS config used instead of Vite plugin

**What goes wrong:** Developer copies a Tailwind v3 setup guide and creates `tailwind.config.js` + `postcss.config.js`. Tailwind v4 ignores these when using `@tailwindcss/vite`; styles are silently absent.

**How to avoid:** Tailwind v4 + Vite: add `tailwindcss()` to `vite.config.ts` plugins. In CSS: `@import "tailwindcss"` (not `@tailwind base; @tailwind components; @tailwind utilities`). No `tailwind.config.js` needed for basic setup.

---

### Pitfall 5: shadcn components added before `init` runs

**What goes wrong:** `npx shadcn@latest add button` fails or produces broken imports because `components.json` and the CSS variable setup do not exist yet.

**How to avoid:** Run `npx shadcn@latest init` first. This creates `components.json`, sets up `src/components/ui/`, and writes the CSS variable tokens. Then add individual components.

---

### Pitfall 6: chat SSE response missing `X-Accel-Buffering: no`

**What goes wrong:** The chat stream (`POST /api/chat/stream`) is buffered by nginx even after the BFF-03 synthetic proof passes. The BFF's `ModifyResponse` hook on the chat director was not setting `X-Accel-Buffering: no`.

**Why it happens:** flowd sets `X-Accel-Buffering: no` itself (confirmed from source). The chat service (`llm-agent-customer-support/internal/httpapi/httpapi.go`) does NOT. Without it, nginx may buffer the chat stream even with `proxy_buffering off` at the nginx location level (defense-in-depth).

**How to avoid:** Add a `ModifyResponse` hook to all three proxy directors that sets `X-Accel-Buffering: no` when `Content-Type` contains `text/event-stream`. This is defense-in-depth — the nginx config is the primary protection, but the header makes the response self-describing for any intermediate proxy.

---

### Pitfall 7: `X-Session-Id` direction confusion for chat

**What goes wrong:** The SPA sends `X-Console-Session` to the BFF expecting it to be forwarded to the chat service as a session continuation mechanism. But the chat service sets `X-Session-Id` in the **response** header, not reads it from the request header. The BFF forwards it as a request header; the chat service ignores it.

**Why it happens:** Chat session continuity works via the request **body** (`session_id` JSON field in `ChatRequest`), not via a request header. The `X-Session-Id` header in the response is informational.

**How to avoid:** For Phase 1, the chat director does NOT need to forward any session header. Session continuity (reading the response `X-Session-Id` and sending it back as a body field) is a Phase 4 concern. Document this in the chat director comment.

---

### Pitfall 8: `Authorization` header forwarded to upstreams

**What goes wrong:** The BFF's `Rewrite` hook deletes `Authorization` from `r.Out` but the operator's BFF-layer token is still visible to the upstream service. Flowd's `BearerTokenAuthenticator` rejects it with 403 because it doesn't match the flowd token.

**Why it happens:** The ReverseProxy's `Rewrite` hook uses `r.Out.Header.Del("Authorization")` then `r.Out.Header.Set("Authorization", "Bearer "+flowdToken)`. This is correct for the flow director. The memory and chat directors must also `Del("Authorization")` without setting a new one — forgetting the `Del` means the browser's operator token is forwarded.

**How to avoid:** Every director explicitly `Del("Authorization")` before conditionally setting a new one. Never leave it up to ReverseProxy defaults.

---

## Runtime State Inventory

This is a greenfield phase — no rename/refactor involved. Step 2.5 SKIPPED (no stored data, live service config, OS-registered state, secrets/env vars, or build artifacts to inventory).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Director` hook in `httputil.ReverseProxy` | `Rewrite func(*ProxyRequest)` hook | Go 1.20 | `Director` is deprecated; `Rewrite` has access to both `r.In` and `r.Out`; safer |
| PostCSS config for Tailwind | `@tailwindcss/vite` plugin + `@import "tailwindcss"` | Tailwind v4 (2024) | No `tailwind.config.js` needed for basic setup; all docs before v4 are wrong |
| shadcn CLI 3.x | shadcn CLI 4.x | ~2026-04 | Current `latest` is 4.10.0; v4 fully supports React 19 + Tailwind v4 |
| `EventSource` for SSE | `@microsoft/fetch-event-source` | Project constraint | EventSource is GET-only; both stream endpoints are POST |
| TypeScript 5.x as `latest` | TypeScript 6.0.3 is now `latest` | 2026-04 | Pin to 5.9.3 explicitly; 6.0 too new for full ecosystem alignment |
| Go `net/http/httputil` `FlushInterval` manual set | Auto-set for streaming responses | Go 1.12+ | No config needed for SSE auto-flush |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `gopkg.in/yaml.v3` is available in Go module cache and suitable for config parsing | Standard Stack (Go) | Low risk — it's in the local Go cache (verified with `go doc`); fallback is `encoding/json` |
| A2 | The BFF listens on port 8090 internally (nginx proxies to `:8090`) | All architecture patterns | Planner decides the port; just needs to be consistent between nginx config and BFF main.go |
| A3 | The nginx SSE location regex `~* ^/api/.*stream` correctly matches `/api/stream/test` and `/api/flow/{id}/run/stream` without false positives | Pattern 4 nginx config | If the regex is wrong, SSE routes won't get the correct buffering settings; must be tested |
| A4 | `r.SetURL(base)` with `http.StripPrefix` correctly strips the `/api/{service}` prefix before the proxy rewrites the URL | Pattern 1 | If wrong, upstreams receive `/api/memory/...` instead of `/memory/...`; must be verified in integration test |
| A5 | shadcn CLI 4.10.0 `init` generates correct dark-mode CSS variable structure compatible with the UI-SPEC tokens | Pattern 5 (SPA scaffold) | If shadcn init generates light-mode defaults, CSS variables need manual override; low risk since variables are in index.css |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.

---

## Open Questions

1. **BFF `/api/config/env` endpoint for SHELL-04 (active environment indicator)**
   - What we know: SHELL-04 requires the BFF's target environment to be displayed in the shell.
   - What's unclear: Should this be a BFF endpoint that returns the env name from config, or should it be baked into the Vite build at build time?
   - Recommendation: Add a `GET /api/config/env` endpoint on the BFF that returns `{"env": "dev", "memory_base": "http://localhost:8080", ...}` (excluding secrets). Simple, always accurate, consistent between dev and prod.

2. **nginx SSE location regex — should it use path suffix or content-type?**
   - What we know: Using a URL regex to identify SSE routes is fragile if route names don't contain "stream".
   - What's unclear: The better approach is `proxy_no_buffering` based on `Content-Type: text/event-stream` in the upstream response, not URL pattern.
   - Recommendation: Use nginx's `map` directive to set `$proxy_buffering` based on `$upstream_http_content_type` containing `text/event-stream`. This is more robust. Alternatively, accept the regex approach for Phase 1 since the only SSE routes in Phase 1 are `/api/stream/test` and (later) `/api/flow/*/run/stream`, `/api/flow/*/runs/*/replay`, `/api/chat/stream` — all contain "stream".

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Go | BFF | ✓ | 1.26.0 | — |
| Node.js | SPA scaffold | ✓ | 22.22.0 | — |
| npm | SPA scaffold | ✓ | (bundled with Node) | — |
| Docker | compose stack deployment | ✓ | 29.5.2 | Manual process start |
| nginx | Fronting host (BFF-03 proof) | ✗ (not installed on host) | — | Docker `nginx:alpine` container |
| TypeScript 5.9.3 | SPA | available via npm | 5.9.3 (must pin) | — |
| TypeScript 6.0.3 | NOT wanted | — | — | Use 5.9.3 explicitly |

**Missing dependencies with no fallback:** None — nginx is needed for the BFF-03 proof but is available as a Docker container (`docker run --rm nginx:alpine`).

**Missing dependencies with fallback:**
- `nginx` not installed on host OS → use `docker run` with the nginx:alpine image + a bind-mounted config for the BFF-03 proof and deployment.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 + Go `testing` + `httptest` |
| Config file | `web/vitest.config.ts` (Wave 0) |
| Quick run command | `cd web && npx vitest run --reporter=verbose` |
| Full suite command | `cd web && npx vitest run && cd .. && go test ./...` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BFF-01 | Allowlisted routes dispatch to correct upstream; non-allowlisted returns 404 | unit (Go httptest) | `go test ./internal/proxy/... -run TestAllowlist` | ❌ Wave 0 |
| BFF-02 | Strip inbound `X-Tenant-Id` / `Authorization`; re-materialize from `X-Console-*`; flowd gets Bearer; chat gets none | unit (Go httptest) | `go test ./internal/proxy/... -run TestAuthInjection` | ❌ Wave 0 |
| BFF-03 | Synthetic SSE endpoint emits events incrementally (not batched); nginx SSE location receives unbuffered events | integration (curl -N + Go httptest for BFF unit) | `go test ./internal/router/... -run TestSyntheticSSE`; manual: `curl -N /api/stream/test` | ❌ Wave 0 |
| BFF-04 | Upstream 4xx/5xx status codes and error bodies pass through unchanged | unit (Go httptest) | `go test ./internal/proxy/... -run TestErrorPassthrough` | ❌ Wave 0 |
| SHELL-01 | Nav renders Memory/Flow/Chat links; active item highlighted | unit (Vitest + RTL) | `npx vitest run NavBar` | ❌ Wave 0 |
| SHELL-03 | Operator context stored/restored from localStorage; `X-Console-*` headers injected on fetch | unit (Vitest) | `npx vitest run OperatorContext` | ❌ Wave 0 |
| SHELL-04 | Env indicator displays value from `/api/config/env` | unit (Vitest + RTL, mock fetch) | `npx vitest run EnvIndicator` | ❌ Wave 0 |
| SHELL-05 | FiveStateWrapper renders distinct loading/empty/error/partial/ready states | unit (Vitest + RTL) | `npx vitest run FiveStateWrapper` | ❌ Wave 0 |
| SHELL-06 | Toast shows on context save; error toast persists with upstream message | unit (Vitest + RTL) | `npx vitest run Toast` | ❌ Wave 0 |
| SHELL-07 | RawJsonViewer collapses/expands; copy button copies JSON; CopyableId copies to clipboard | unit (Vitest + RTL) | `npx vitest run RawJsonViewer CopyableId` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `go test ./... && cd web && npx vitest run --reporter=dot`
- **Per wave merge:** Full suite: `go test ./... && cd web && npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `web/vitest.config.ts` — Vitest configuration with jsdom environment
- [ ] `web/src/test/setup.ts` — testing-library jest-dom matchers
- [ ] `internal/proxy/memory_test.go` — BFF-02 unit tests
- [ ] `internal/proxy/flow_test.go` — BFF-02 unit tests
- [ ] `internal/proxy/auth_test.go` — operator token constant-time check
- [ ] `internal/router/sse_test.go` — BFF-03 synthetic SSE unit test
- [ ] Framework install: `npm install -D vitest@4.1.8 @testing-library/react@16.3.2 @testing-library/jest-dom`

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | BFF app-layer operator token (constant-time comparison; empty=disabled in dev) |
| V3 Session Management | no | No cookie session; stateless per-request auth |
| V4 Access Control | yes | Allowlisted routes only; no open pass-through; per-upstream auth model |
| V5 Input Validation | yes | Allowlisted upstream hosts pinned in config; no client-controlled target |
| V6 Cryptography | partial | Operator token comparison uses byte-XOR (acceptable for v1 shared static token); no crypto secrets generated |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SSRF via proxy path manipulation | Tampering | Upstream hosts pinned in config; only allowlisted routes dispatched |
| Confused-deputy scope injection (client sends `X-Tenant-Id`) | Spoofing | Strip ALL `X-*-Id` headers in `Rewrite` hook before re-materializing from `X-Console-*` |
| flowd bearer token leak to browser | Information Disclosure | Token lives in BFF config only; `Rewrite` hook strips inbound `Authorization`, sets outbound only for flowd director |
| Token in SSE URL query string | Information Disclosure | Browser → BFF auth via `Authorization: Bearer` header (fetch-event-source supports headers on POST); never in URL |
| Operator token timing attack | Spoofing | Constant-time byte-XOR comparison (modeled on flowd's BearerTokenAuthenticator) |

---

## Sources

### Primary (HIGH confidence)

- `go doc net/http/httputil ReverseProxy` — Go 1.26.0 on this machine; `Rewrite` API, `FlushInterval` auto-streaming, `ModifyResponse`, `Director` deprecated — [VERIFIED]
- `go doc net/http/httputil ProxyRequest` — `r.In`, `r.Out`, `r.SetURL()` API — [VERIFIED]
- `llm-agent-flow/cmd/flowd/server/server.go` — `writeSSE`, `runWithStore`, `handleReplayRun`, SSE headers (`X-Accel-Buffering: no`, `Cache-Control: no-cache`), event kinds — [VERIFIED: read from source]
- `llm-agent-flow/cmd/flowd/server/auth.go` — `BearerTokenAuthenticator` constant-time comparison, `authBypass` for `/healthz`, `withAuth` middleware — [VERIFIED: read from source]
- `llm-agent-memory-gateway/internal/authz/scope.go` — `ScopeFromHeaders`, `MergeAuthoritativeScope`, required `X-Tenant-Id`/`X-User-Id` — [VERIFIED: read from source]
- `llm-agent-memory-gateway/internal/transport/router.go` — route listing, `readAuthoritativeScope` from headers — [VERIFIED: read from source]
- `llm-agent-customer-support/internal/httpapi/httpapi.go` — `handleStream` SSE headers (no `X-Accel-Buffering: no`), `X-Session-Id` in response, `StreamEnvelope` format — [VERIFIED: read from source]
- npm registry `npm view <pkg>` for all listed packages — 2026-06-03 — [VERIFIED]

### Secondary (MEDIUM confidence)

- `.planning/research/ARCHITECTURE.md` — per-upstream director pattern, SSE location in nginx, Option A project structure — [CITED: project research]
- `.planning/research/PITFALLS.md` — nginx buffering pitfalls, SSE survival primitive (raised `proxy_read_timeout`), auth boundary strip/re-materialize — [CITED: project research]
- `.planning/research/STACK.md` — version compatibility table, Tailwind v4 plugin pattern, shadcn React 19 compatibility — [CITED: project research]
- OneUptime nginx SSE guide (proxy_buffering off, X-Accel-Buffering, gzip off, timeouts) — [CITED: via PITFALLS.md]

### Tertiary (LOW confidence)

- None — all critical claims verified from primary sources.

---

## Metadata

**Confidence breakdown:**
- Go BFF patterns: HIGH — verified from Go stdlib docs + reference source code in sibling repos
- Auth boundary: HIGH — verified from `authz/scope.go` + `auth.go` source; exact header names and strip/re-materialize logic confirmed
- SSE wire format: HIGH — confirmed from `writeSSE` source in both flowd and chat; no heartbeat confirmed
- SPA scaffold: HIGH — all package versions verified via `npm view`; Tailwind v4 + shadcn 4.x documented
- nginx config: MEDIUM — config pattern from PITFALLS.md + multiple production SSE guides; specific `proxy_no_buffering` via content-type remains an open question
- TypeScript 5.9.3 / shadcn 4.x version notes: HIGH — verified on npm registry

**Research date:** 2026-06-03
**Valid until:** 2026-07-03 (30 days for stable stack); TypeScript + shadcn versions are moving fast — re-verify if implementing after 2026-06-20.
