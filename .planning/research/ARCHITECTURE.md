# Architecture Research

**Domain:** Internal admin/ops console + thin single-origin BFF (reverse proxy fronting 3 fixed backend services, 2 of which stream SSE)
**Researched:** 2026-06-03
**Confidence:** HIGH (core BFF/SSE constraints verified against Go stdlib docs + multiple proxy-buffering sources; frontend specifics MEDIUM, stack-dependent)

> ⚠️ **Decision override (2026-06-03, Phase-1 CONTEXT D-04/D-05/D-06):** This document recommends a **single-binary `go:embed` co-deployment** (Static asset server via `embed.FS`, Pattern 5, the "Deployment" notes). The Phase-1 discussion **chose the opposite**: a **proxy-only BFF** (no embedded SPA) with the built SPA served by a **fronting static host (nginx)** that also proxies `/api/*` to the BFF on one origin. Where this doc and `.planning/phases/01-foundation/01-CONTEXT.md` disagree on packaging, **CONTEXT wins**. Consequence: the fronting proxy is now a **mandatory** SSE-buffering surface (`proxy_buffering off`, no gzip on `text/event-stream`, `X-Accel-Buffering: no` passthrough) — the BFF-03 acceptance gate must be proven through it. The component boundaries, REST-vs-SSE split, and vertical-slice build order below remain valid.

## Standard Architecture

### System Overview

This is the canonical **BFF / single-origin reverse-proxy** topology: one browser app and one server process under one origin, with the server fanning out to N upstream services and injecting each one's distinct auth server-side. The only non-standard wrinkle is that two of three upstreams stream **SSE over POST**, which constrains both the BFF runtime and the browser client.

```
┌───────────────────────────────────────────────────────────────────────┐
│                         BROWSER (single origin)                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Console SPA shell:  nav + shared layout + operator context       │  │
│  │  ┌────────────┐   ┌────────────┐   ┌────────────┐                 │  │
│  │  │  Memory    │   │   Flow     │   │   Chat     │   area views     │  │
│  │  │  area      │   │   area     │   │   area     │                  │  │
│  │  └─────┬──────┘   └─────┬──────┘   └─────┬──────┘                 │  │
│  │   REST │            REST│ + SSE      SSE │ + REST                  │  │
│  └────────┼────────────────┼────────────────┼─────────────────────────┘ │
│           │   all requests same origin under one /api/* prefix          │
│           │   (SSE rides /api/.../stream — NOT a separate /stream/*)     │
└───────────┼────────────────┼────────────────┼─────────────────────────┘
            ▼                ▼                ▼
┌───────────────────────────────────────────────────────────────────────┐
│   FRONTING nginx (proxy-only): serves built SPA at /, proxies /api/* →   │
│   BFF (no auth here); SSE locations: proxy_buffering off, gzip off,      │
│   raised proxy_read_timeout                                              │
└───────────┼────────────────┼────────────────┼─────────────────────────┘
            ▼                ▼                ▼
┌───────────────────────────────────────────────────────────────────────┐
│                  BFF / REVERSE PROXY (this repo, proxy-only)             │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │  route namespacing router (serves NO static assets)               │  │
│   ├─────────────────────────────────────────────────────────────────┤  │
│   │  /api/memory/* ─┐   /api/flow/* (+ .../stream) ─┐  /api/chat/stream│ │
│   │                 │                                │                │  │
│   │  per-upstream proxy handlers (one director per service)           │  │
│   │  • strip inbound X-*-Id + Authorization → re-materialize auth      │  │
│   │  • streaming pass-through (flush, no buffer) for text/event-stream │  │
│   │  • per-service base URL + secret from env/config                   │  │
│   └─────┬──────────────────────┬───────────────────────┬───────────────┘ │
│  inject X-Tenant/X-User   inject Bearer FLOWD_TOKEN   inject nothing     │
│  (from X-Console-*)                                                      │
└────────┼──────────────────────┼───────────────────────┼─────────────────┘
         ▼                      ▼                        ▼
┌────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│ memory-gateway │   │       flowd          │   │  customer-support    │
│ :8080 REST     │   │ :7861 REST + SSE     │   │  :8080 SSE + REST    │
│ +/metrics      │   │ (POST run/stream,    │   │ (POST /chat/stream)  │
│                │   │  POST replay)        │   │                      │
└────────────────┘   └──────────────────────┘   └──────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **Static asset host** *(updated 2026-06-03)* | Serve the built SPA bundle + index.html (SPA fallback) from the same origin as the API | **fronting nginx** (NOT the BFF — the BFF is proxy-only and `go:embed`'s nothing) |
| **Proxy router** | Namespace routes per upstream under **one `/api/*` prefix** (`/api/memory/*`, `/api/flow/*` incl. `/api/flow/.../stream`, `/api/chat/stream`); dispatch to the right proxy handler *(updated 2026-06-03: SSE rides the `/api/*` prefix — no separate top-level `/stream/*`)* | std router / chi (Go) |
| **Per-service proxy handler** | One reverse-proxy "director" per upstream: rewrite path, set upstream base URL, inject that service's auth, strip client-supplied auth/scope/hop headers | `httputil.ReverseProxy` per backend (Go), one per base URL |
| **Auth injector** *(updated 2026-06-03)* | Server-side credential injection: **strip inbound `X-*-Id` + `Authorization`, then re-materialize** gateway `X-Tenant-Id`/`X-User-Id` (+ optional `X-Project-Id`/`X-Session-Id`) from the SPA's non-secret `X-Console-*` headers; inject flowd `Authorization: Bearer <FLOWD_TOKEN>` (secret, never leaves server); chat none. The gateway's `MergeAuthoritativeScope` forces header scope over body scope | director `Rewrite`/`Director` func |
| **SSE pass-through** | Forward `text/event-stream` responses to the browser unbuffered, flushing each chunk; long-lived connection; honor client disconnect/`ctx` cancellation. **Pure pass-through — injects no heartbeat/`retry:`/`id:`** (upstreams emit none); idle survival is the fronting nginx's raised `proxy_read_timeout` | `ReverseProxy` auto-flush on `text/event-stream` (Go) — see Pattern 2 |
| **Health/observability surface** | Aggregate upstream `/healthz`/`/readyz` and proxy gateway `/metrics`; expose own `/healthz` | small fan-out handler |
| **Config loader** | 3 upstream base URLs + flowd secret from env; fail fast if missing | env vars / config struct |
| **SPA shell** | Nav across memory/flow/chat areas, shared layout, **operator context** (tenant/user/session/project selection) that feeds the `X-Console-*` headers the BFF re-materializes into gateway scope headers | React/Vue SPA + router |
| **Area views** | Per-domain UI: REST query/cache for CRUD + reads; live SSE subscription for flow runs and chat | TanStack Query (REST) + fetch/ReadableStream (SSE) |

## Recommended Project Structure

*(updated 2026-06-03: the stack is no longer TBD — proxy-only Go BFF + a separately-built SPA served by a fronting nginx. Single origin is provided by nginx, NOT by embedding the SPA in the BFF. Option B below is retained only as a rejected alternative.)*

**Option A — proxy-only Go BFF + separate SPA build served by fronting nginx (CHOSEN; see Pattern 5):**

```
llm-agent-console/
├── cmd/
│   └── console/             # main: load config, build proxies, serve
├── internal/
│   ├── proxy/               # one reverse-proxy per upstream
│   │   ├── memory.go        # director: inject X-Tenant/X-User
│   │   ├── flow.go          # director: inject Bearer FLOWD_TOKEN
│   │   ├── chat.go          # director: no auth
│   │   └── sse.go           # shared streaming/flush helpers (if needed)
│   ├── router/              # route namespacing → proxy dispatch + SPA fallback
│   ├── health/              # upstream health fan-out + /metrics passthrough
│   └── config/              # 3 base URLs + secrets from env
├── web/                     # SPA source (built into web/dist, served by fronting nginx — NOT go:embed'd)
│   ├── src/
│   │   ├── app/             # shell: layout, nav, operator-context provider
│   │   ├── features/
│   │   │   ├── memory/      # REST views (recall, item, lifecycle actions)
│   │   │   ├── flow/        # CRUD (REST) + live run view (SSE)
│   │   │   └── chat/        # chat session + streamed steps (SSE)
│   │   ├── lib/
│   │   │   ├── api.ts       # REST client (fetch → /api/*)
│   │   │   └── sse.ts       # fetch+ReadableStream SSE-over-POST reader
│   │   └── components/      # shared UI (health badges, error surfaces)
│   └── dist/                # built bundle (served by fronting nginx)
└── deploy/
    ├── nginx.conf           # fronting host: serve web/dist at /, proxy /api/* → BFF (SSE: buffering/gzip off, raised read timeout)
    └── docker-compose.*.yml # proxy-only BFF + fronting nginx alongside existing stack
```

**Option B — JS-server BFF (Next.js / Nuxt / Remix server runtime) — REJECTED:** SPA and proxy live in the same framework project; proxy routes are server route handlers that stream. Viable but carries SSE/serverless caveats (Pattern 2 / Anti-Pattern 1). *(updated 2026-06-03: not chosen — the stack is the proxy-only Go BFF of Option A.)*

### Structure Rationale

- **`internal/proxy/` one file per upstream:** the three services have three auth models and three base URLs. Isolating each director keeps auth injection explicit and auditable, and makes the vertical-slice build order natural (add one file at a time).
- **`web/features/<area>/`:** mirrors the three console areas; each area owns its REST and SSE data flow, sharing only the shell and operator context.
- **`lib/sse.ts` separate from `lib/api.ts`:** SSE-over-POST is fundamentally different from REST request/response and must not be forced into the REST/cache layer (see Data Flow + Anti-Pattern 3).

## Architectural Patterns

### Pattern 1: One reverse-proxy "director" per upstream (server-side auth injection)

**What:** Build a distinct reverse proxy per backend, each with a director that rewrites the path, points at that service's base URL, **strips any client-supplied auth/hop-by-hop headers**, and injects the correct server-side credential.
**When to use:** Always here — three services, three auth models, single origin.
**Trade-offs:** More handlers than a generic catch-all proxy, but each auth boundary is explicit and testable; avoids a single director with brittle per-path conditionals.

**Example (Go, conceptual):** *(updated 2026-06-03: scope arrives as `X-Console-*` and is re-materialized; the BFF strips/renames, never trusts a client-set `X-Tenant-Id`.)*
```go
// flowd: inject the bearer token server-side; client never sees it
flowProxy := &httputil.ReverseProxy{
    Rewrite: func(r *httputil.ProxyRequest) {
        r.SetURL(flowdBase)                 // base URL from env
        r.Out.Header.Del("Authorization")   // strip anything from the browser
        r.Out.Header.Set("Authorization", "Bearer "+flowdToken)
    },
}

// memory: tenant/user are operator CONTEXT (non-secret), conveyed by the SPA as
// X-Console-*. The BFF DELETES any client-set X-Tenant-Id/X-User-Id (never trusted)
// and re-materializes them from the X-Console-* values, mirroring the flowd stub.
memoryProxy := &httputil.ReverseProxy{
    Rewrite: func(r *httputil.ProxyRequest) {
        r.SetURL(memoryBase)
        // strip the inbound Authorization (operator token is app-layer, not forwarded)
        r.Out.Header.Del("Authorization")
        // strip any client-supplied trusted scope headers...
        r.Out.Header.Del("X-Tenant-Id")
        r.Out.Header.Del("X-User-Id")
        r.Out.Header.Del("X-Project-Id")
        r.Out.Header.Del("X-Session-Id")
        // ...then re-materialize them from the non-secret X-Console-* context.
        // (validate/allowlist server-side rather than trusting blindly)
        r.Out.Header.Set("X-Tenant-Id", r.In.Header.Get("X-Console-Tenant"))
        r.Out.Header.Set("X-User-Id", r.In.Header.Get("X-Console-User"))
        if p := r.In.Header.Get("X-Console-Project"); p != "" {
            r.Out.Header.Set("X-Project-Id", p)
        }
        if s := r.In.Header.Get("X-Console-Session"); s != "" {
            r.Out.Header.Set("X-Session-Id", s)
        }
        r.Out.Header.Del("X-Console-Tenant") // don't forward the console-side names
        r.Out.Header.Del("X-Console-User")
        r.Out.Header.Del("X-Console-Project")
        r.Out.Header.Del("X-Console-Session")
    },
}
// NOTE: the gateway's MergeAuthoritativeScope (internal/authz/scope.go) forces these
// HEADER values over any scope in the request body — so re-materializing the headers
// correctly *is* the authoritative scope; body-conveyed scope cannot override it.
```

### Pattern 2: SSE streaming pass-through (flush, no buffering) — the load-bearing constraint

**What:** Forward `text/event-stream` responses to the browser **unbuffered**, flushing every chunk, holding the connection open for the run/chat lifetime, and cancelling the upstream call when the browser disconnects.
**When to use:** flowd `run/stream` + `replay`, chat `/chat/stream`.
**Trade-offs:** Requires a runtime that supports long-lived streaming responses and per-write flushing. This is trivial in Go's stdlib and Node's raw HTTP server, but fragile on serverless/edge.

**Verified facts (HIGH confidence):**
- Go's `httputil.ReverseProxy` **auto-detects streaming**: per the official docs, "FlushInterval is ignored when ReverseProxy recognizes a response as a streaming response, or if its ContentLength is -1; for such responses, writes are flushed to the client immediately." It treats `Content-Type: text/event-stream` (including `; charset=utf-8`) as streaming. So Go needs essentially **zero tuning** to proxy SSE correctly. [golang issue #47359, pkg.go.dev]
- Any **intermediate proxy** (nginx, Traefik, ALB, Cloudflare) buffers by default and will turn the stream into a batch. Mitigate by setting `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform` and disabling gzip/compression on stream routes. [multiple sources]

**Example (Go):** *(updated 2026-06-03: SSE rides the `/api/*` prefix — no separate `/stream/*` top-level prefix.)*
```go
// No FlushInterval needed: ReverseProxy flushes text/event-stream immediately.
// Just ensure no compression middleware wraps the stream routes, and pass
// the request context so upstream cancels on client disconnect.
// Pure pass-through: the BFF injects no heartbeat (upstreams emit none) — idle
// survival is the fronting nginx's raised proxy_read_timeout.
mux.Handle("/api/chat/stream", http.StripPrefix("/api/chat", chatProxy))
```

### Pattern 3: Browser SSE over POST via fetch + ReadableStream (NOT EventSource)

**What:** Consume SSE on the client with `fetch(..., {method:'POST'})` and read `response.body` via a `ReadableStream` reader, parsing the `text/event-stream` framing manually.
**When to use:** Required here — both streaming endpoints are **POST** (`POST /flows/{id}/run/stream`, `POST /chat/stream`), and native `EventSource` is **GET-only and cannot send a body or custom headers**. [MDN]
**Trade-offs:** Slightly more client code (manual `\n\n` event parsing, buffer the trailing fragment, handle reconnect yourself) — but it is the only option for POST-initiated streams and gives full control over headers and cancellation (`AbortController`).

**Example (TS, conceptual):**
```ts
const res = await fetch("/api/flow/<id>/run/stream", { method: "POST", body, signal }); // SSE under /api/*
const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
// loop: read chunks, split on "\n\n", parse event:/data: lines, dispatch to UI
```

### Pattern 4: REST cache vs live SSE subscription (separate data paths)

**What:** Route durable request/response data (memory recall, item reads, flow CRUD, past runs/events, chat history) through a **query/cache layer** (e.g. TanStack Query). Route live streams through a **dedicated subscription** that updates local view state, and only *touch* the query cache at boundaries (e.g. invalidate `runs` list when a run completes).
**When to use:** Every area. Keeps caching correctness (REST) separate from ephemeral stream state.
**Trade-offs:** Two mental models in one app, but conflating them (forcing SSE into the cache) is a known footgun — TanStack Query has no native SSE; you own the EventSource/reader and choose invalidate-vs-direct-update. [tkdodo, TanStack docs]

### Pattern 5: Single-origin co-deployment (fronting nginx serves the SPA + proxies `/api/*` to the proxy-only BFF)

*(updated 2026-06-03: this project does NOT embed the SPA in the BFF — see the top banner and Phase-1 CONTEXT D-04/D-05.)*

**What:** A **fronting nginx** serves the built SPA bundle at `/` (with SPA fallback to `index.html`) **and** reverse-proxies the `/api/*` prefix to the proxy-only Go BFF on the same origin. No CORS. The BFF serves no static assets.
**When to use:** This project's explicit single-origin constraint, satisfied by the fronting host rather than by embedding.
**Trade-offs:** Two deploy units (nginx + BFF) instead of one binary, but the fronting host is *required anyway* as the mandatory SSE-buffering surface (it must set `proxy_buffering off`, gzip off, and a raised `proxy_read_timeout` on SSE locations). A `go:embed` single binary was explicitly rejected in Phase-1 CONTEXT. A JS-server BFF unifies build/deploy but inherits the framework's streaming constraints — also rejected.

## Data Flow

### REST request flow (memory CRUD, flow CRUD, history, health)

```
[Operator action in area view]
   ↓
[TanStack Query / REST client]  →  fetch /api/<service>/...  (same origin)
   ↓
[BFF proxy router]  →  [per-service director: strip client auth, inject server auth]
   ↓
[Upstream REST service]
   ↓
[JSON response]  ←  [proxy pass-through]  ←  cached + rendered in area view
```

### Live SSE subscription flow (flow runs/replay, chat steps)

```
[Operator: "run flow" / "send message"]
   ↓
[fetch + ReadableStream (POST), AbortController]  →  POST /api/<service>/.../stream
   ↓
[BFF proxy: inject auth, DO NOT buffer, flush each chunk, ctx cancels on disconnect]
   ↓
[Upstream emits text/event-stream events...]   (long-lived)
   ↓  (chunk by chunk)
[Client reader parses events]  →  append to live view state
   ↓  (on terminal event)
[invalidate related REST query]  (e.g. refetch runs list)
```

### Operator context flow (feeds gateway headers) *(updated 2026-06-03: X-Console-* → BFF re-materializes)*

```
[Shell: operator selects tenant / user / (project / session)]  (remembered in localStorage; non-secret)
   ↓
[Operator-context provider (app-level state)]
   ↓ supplies non-secret context as X-Console-Tenant / X-Console-User / X-Console-Project / X-Console-Session
[Memory area REST/SSE requests]
   ↓
[BFF director]  strips any client-set X-*-Id + Authorization, then RENAMES/re-materializes:
                X-Console-Tenant → X-Tenant-Id, X-Console-User → X-User-Id,
                X-Console-Project → X-Project-Id, X-Console-Session → X-Session-Id
   ↓
[memory-gateway]  (MergeAuthoritativeScope forces these header values over any body scope)
```

Key point: **tenant/user are operator *context*, not secrets** — they are chosen in the UI, sent as `X-Console-*`, and re-materialized server-side (never trusted as a client-set `X-Tenant-Id`); the **flowd bearer token is a secret** that lives only in the BFF env and is never sent to or selectable from the browser. The optional **operator token** the browser sends as `Authorization: Bearer` is verified at the BFF app layer and consumed (not forwarded), and is held in memory, not `localStorage`.

### Key Data Flows

1. **Memory:** all REST. Operator context → headers. CRUD + recall via query cache; `/metrics` surfaced read-only in health view.
2. **Flow:** hybrid. CRUD + past runs/events = REST/cache; live run/replay = SSE-over-POST subscription that updates a run-timeline view, then invalidates the runs list on completion.
3. **Chat:** primarily SSE. `POST /chat/stream` drives a streamed step view; session continuity via a client-held session id; optional non-stream `POST /chat` for fallback.

## Scaling Considerations

This is an **internal operator tool** (handful of concurrent operators), so classic web-scale concerns barely apply. The relevant axis is **concurrent long-lived SSE connections**, not request throughput.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-10 operators | Single BFF instance, single binary, compose service. No tuning needed. Go handles thousands of idle streaming goroutines easily. |
| 10-50 operators | Still single instance; ensure server/timeouts/keep-alive allow long-lived streams (no aggressive idle timeout on stream routes). |
| 50+ / HA | If you ever load-balance, use sticky sessions or accept that each SSE connection pins to one BFF instance; ensure the LB itself doesn't buffer/time out streams. Unlikely for an internal tool. |

### Scaling Priorities

1. **First "bottleneck" is timeouts, not load:** the realistic failure is an intermediary (LB/proxy/server write timeout) killing a long run/chat stream. Configure no/long write-timeout on stream routes; set `X-Accel-Buffering: no`.
2. **Second is fan-out health checks:** if the health view polls all upstreams aggressively, debounce/cache it. Trivial.

## Anti-Patterns

### Anti-Pattern 1: Hosting the SSE-proxying BFF on serverless/edge with execution limits

**What people do:** Deploy the BFF as serverless/edge functions (Vercel, Lambda, edge runtime).
**Why it's wrong:** These enforce execution-time limits (e.g. 10-60s) and often buffer/transform responses — long flow runs and chat streams get cut off or batched. Edge runtimes have additional streaming constraints. [Next.js/Vercel SSE discussions]
**Do this instead:** Run the BFF as a **long-lived process** — a Go binary or Node server — as a compose service alongside the existing stack. This is also the simplest deploy: one container, same origin.

### Anti-Pattern 2: Buffering / compressing / "improving" the stream in the BFF

**What people do:** Wrap all routes in gzip/compression middleware or a buffering response writer.
**Why it's wrong:** Compression and buffering both defeat SSE — the client sees nothing until the buffer fills or the connection ends. Go's `ReverseProxy` flushes `text/event-stream` automatically, but a compression middleware in front of it re-buffers.
**Do this instead:** Exclude the SSE routes (under `/api/.../stream`) from any compression/buffering middleware; set `Cache-Control: no-cache, no-transform`. *(updated 2026-06-03: SSE rides the `/api/*` prefix — no separate `/stream/*`.)*

### Anti-Pattern 3: Forcing SSE into the REST query/cache layer (or using EventSource for the POST streams)

**What people do:** Try to model the live stream as a TanStack Query query, or reach for `EventSource`.
**Why it's wrong:** TanStack Query has no native SSE; and `EventSource` is GET-only with no body/custom-header support — it **cannot** call `POST /chat/stream` or `POST /flows/{id}/run/stream`.
**Do this instead:** Use `fetch` + `ReadableStream` for the streams (Pattern 3); keep REST in the cache layer; bridge them only via cache invalidation at stream boundaries (Pattern 4).

### Anti-Pattern 4: Trusting browser-supplied auth context blindly

**What people do:** Let the browser send the flowd token, or forward whatever `X-Tenant-Id` the browser sets without scoping.
**Why it's wrong:** The whole point of the BFF is that secrets (flowd token) never reach the browser, and operator context is constrained server-side.
**Do this instead:** The flowd token lives only in BFF env. Strip any client `Authorization` (the operator token is verified app-layer, not forwarded) and any client-set `X-*-Id` before injecting. Treat tenant/user as selectable context conveyed via `X-Console-*` and re-materialized into `X-Tenant-Id`/`X-User-Id` server-side, optionally validated against an allowlist. *(updated 2026-06-03)*

## Integration Points

### External Services (the three fixed backends)

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| memory-gateway (:8080) | REST reverse-proxy; re-materialize `X-Tenant-Id`/`X-User-Id` (+ optional `X-Project-Id`/`X-Session-Id`) from the browser's `X-Console-*` context | **only `/metrics`** (no `/healthz`/`/readyz`) — so "healthy" = transport reachability via a cheap probe; `/metrics` proxied read-only into health view; all request/response, no streaming *(updated 2026-06-03)* |
| flowd (:7861) | REST + SSE reverse-proxy; inject `Authorization: Bearer $FLOWD_TOKEN` (secret) | `run/stream` + `replay` are **POST SSE**; `/healthz` open. Stream routes must be unbuffered |
| customer-support (:8080) | REST + SSE reverse-proxy; **no auth** injected | `POST /chat/stream` is the primary path; IP-rate-limited upstream; `/healthz`+`/readyz` |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| SPA ↔ fronting nginx ↔ BFF | HTTP same-origin under one **`/api/*`** prefix (REST + SSE-over-POST, the latter at `/api/.../stream`) | No CORS; single origin provided by the fronting nginx *(updated 2026-06-03: no separate `/stream/*` prefix)* |
| BFF router ↔ per-service proxy | in-process dispatch by route namespace | one director per upstream; auth boundary is here |
| Shell ↔ area views | shared layout + operator-context provider; each area owns its data flow | only context + nav shared |
| REST cache ↔ SSE subscription | cache invalidation at stream terminal events | otherwise independent (Pattern 4) |

## Suggested Build Order (vertical slices)

Build **one service end-to-end before adding the next**, so the BFF skeleton, single-origin co-deploy, and frontend shell all get proven on the simplest slice first. Dependencies flow downward.

1. **BFF skeleton + single-origin shell (foundation).**
   - Config loader (3 base URLs + flowd secret from env, fail-fast), route-namespacing router, own `/healthz`. *(updated 2026-06-03: SPA serving + `index.html` fallback is the fronting nginx's job, not the BFF's — the BFF is proxy-only.)*
   - Minimal SPA shell: layout, nav placeholders for the 3 areas, operator-context provider (tenant/user/session/project selectors).
   - *Verify:* SPA loads from the BFF origin; nav renders; config validated.

2. **Slice 1 — Memory area (REST-only; proves the proxy + auth-injection + cache path).**
   - Memory reverse-proxy director: strip inbound `X-*-Id` + `Authorization`, then re-materialize `X-Tenant-Id`/`X-User-Id` from the browser's `X-Console-*` operator context. *(updated 2026-06-03)*
   - REST client + query cache; recall/search, item view, lifecycle actions (write/patch/pin/disable/delete).
   - *Why first:* no SSE — lowest risk; validates auth injection + operator context + REST cache before tackling streaming.

3. **Slice 2 — Flow area (REST + first SSE; proves streaming pass-through).**
   - Flow director injecting `Bearer $FLOWD_TOKEN`; **stream route wired with no buffering/compression**, request-context cancellation.
   - REST: list/create/edit/delete flows, past runs/events. SSE: `fetch`+`ReadableStream` client for `run/stream` + `replay`; live run-timeline view; invalidate runs list on completion.
   - *Why second:* introduces the load-bearing SSE-through-BFF mechanics on a service that *also* has REST, so the hybrid pattern is established here. Depends on the proxy/auth foundation from Slice 1.

4. **Slice 3 — Chat area (SSE-first; reuses streaming infra).**
   - Chat director (no auth). Reuse the SSE-over-POST client + stream pass-through from Slice 2 for `POST /chat/stream`; session continuity; optional non-stream `/chat` fallback.
   - *Why last:* depends entirely on the streaming infra proven in Slice 2; smallest new surface.

5. **Cross-cutting — Health/observability surface + error surfaces.**
   - Fan-out of upstream `/healthz`/`/readyz` + gateway `/metrics`; per-area error/loading/empty states; stream-error and reconnect UX.
   - *Why after slices:* health needs all three upstreams wired; error surfaces harden the proven happy paths.

6. **Deploy — compose service(s) alongside the existing stack.**
   - *(updated 2026-06-03)* Long-lived process(es): a **proxy-only Go BFF + a fronting nginx** serving the SPA and proxying `/api/*` — NOT a single Go binary with embedded SPA, NOT a JS server. Add as compose service(s) in the umbrella stack; **not** serverless/edge (Anti-Pattern 1). Ensure the fronting nginx does not buffer/gzip and does not idle-timeout the SSE routes under `/api/*` (`proxy_buffering off`, gzip off, raised `proxy_read_timeout`).

Dependency summary: **(1) foundation → (2) memory → (3) flow [adds SSE] → (4) chat [reuses SSE] → (5) health/errors → (6) deploy.** Each slice ships a usable operator capability.

## Sources

- Go `net/http/httputil.ReverseProxy` — FlushInterval / streaming auto-flush (HIGH): https://pkg.go.dev/net/http/httputil#ReverseProxy
- golang/go #47359 — `text/event-stream` (incl. `;charset=utf-8`) treated as streaming, flushed immediately (HIGH): https://github.com/golang/go/issues/47359
- Building an SSE Proxy in Go (MEDIUM): https://medium.com/@sercan.celenk/building-an-sse-proxy-in-go-streaming-and-forwarding-server-sent-events-1c951d3acd70
- Next.js / Vercel SSE streaming + serverless/edge buffering & timeout constraints (MEDIUM): https://github.com/vercel/next.js/discussions/48427 ; https://medium.com/@oyetoketoby80/fixing-slow-sse-server-sent-events-streaming-in-next-js-and-vercel-99f42fbdb996
- Reverse-proxy buffering (`X-Accel-Buffering: no`, no-transform, gzip caveat) (MEDIUM): https://www.learnlog.dev/nextjs-streaming-production-fix
- MDN EventSource — GET-only, no custom headers/body (HIGH): https://developer.mozilla.org/en-US/docs/Web/API/EventSource
- SSE over POST via fetch + ReadableStream (MEDIUM): https://medium.com/@david.richards.tech/sse-server-sent-events-using-a-post-request-without-eventsource-1c0bd6f14425 ; https://www.web-developpeur.com/en/blog/sse-fetch-readable-stream-api-key
- TanStack Query + SSE: no native SSE, invalidate vs direct update; keep cache separate (MEDIUM): https://tkdodo.eu/blog/tan-stack-router-and-query ; https://tanstack.com/query/v5/docs/reference/streamedQuery

---
*Architecture research for: admin/ops console + thin single-origin SSE-proxying BFF*
*Researched: 2026-06-03*
