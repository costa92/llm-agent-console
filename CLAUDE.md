<!-- GSD:project-start source:PROJECT.md -->
## Project

**llm-agent-console**

A unified web **admin / ops console** for the `llm-agent` ecosystem. The ecosystem's
three HTTP services — the **memory gateway**, the **flow engine (flowd)**, and the
**customer-support chat** — are currently headless APIs with no frontend. This project
gives operators a single browser UI to observe and operate all three: inspect and manage
memory, build/run/replay flows, and drive chat sessions. It is an internal operator tool,
not an end-user product.

**Core Value:** Turn the ecosystem's headless service APIs into one usable, observable operator surface.
If everything else fails, an operator must be able to **see and act on what the backend
services are doing** from a single web UI.

### Constraints

- **Architecture**: thin BFF/proxy, single origin — the BFF injects all three auth models server-side; no browser-side CORS or secret handling. *(Chosen over direct+CORS for robustness/security and because the 3 services have 3 different auth models.)*
- **Tech stack**: **to be determined by GSD research** (2025 admin-console standard stack) — not pre-decided. The BFF may be Go (ecosystem-native) or the chosen frontend framework's server layer.
- **Repo placement**: separate sibling repo (`llm-agent-console`) nested under the umbrella, gitignored from it; its own git history + `.planning/`. *(Polyrepo convention.)*
- **Backend contracts are fixed**: consume the existing APIs unchanged; do not modify the backend services.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Headline Recommendation
## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **React** | 19.2.x | UI library | Default for internal tooling; React 19 stable; required by current shadcn/ui & TanStack. |
| **Vite** | 8.0.x | Build tool / dev server | SPA-optimized: sub-second HMR, zero-config TS, deploy-anywhere static output. Standard for internal dashboards where SSR/SEO is irrelevant. |
| **TypeScript** | 5.9.x (not 6.x yet) | Language | End-to-end typing of the BFF↔SPA contract. See Version Compatibility note — pin to 5.9, not the just-released 6.0. |
| **Go (this repo)** | 1.23+ | **BFF / reverse proxy** | Ecosystem-native (the 3 backends are Go); `httputil.ReverseProxy` auto-flushes `text/event-stream` with `FlushInterval=-1`; trivial server-side auth injection per backend. |
| **TanStack Query** | 5.101.x | Server-state / data fetching & cache | Standard for REST-over-HTTP admin UIs: caching, dedupe, invalidation, optimistic mutations for the memory CRUD + flow CRUD. **SSE streams bypass it** (see SSE section). |
| **TanStack Router** | 1.170.x | Routing | Type-safe routes, first-class search-param state (filters/pagination), loader-based prefetch that pairs natively with TanStack Query. Preferred over React Router for a greenfield typed SPA. |
| **Tailwind CSS** | 4.3.x | Styling | v4 engine (`@import "tailwindcss"`, `@tailwindcss/vite` plugin). Required substrate for shadcn/ui. |
| **shadcn/ui** | CLI 3.x | UI component kit | Copy-in components (you own the code) built on Radix primitives + Tailwind. Best polish/control for an internal console; no runtime dependency lock-in. Supports React 19 + Tailwind v4. |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@microsoft/fetch-event-source** | 2.0.1 | SSE-over-`fetch` client (POST + headers + retry control) | **Required** — both SSE endpoints are POST; native `EventSource` can't do POST. See note: this package was *republished/revived 2026-04* (npm `modified` 2026-04-23), so it is the live choice again. |
| **@tailwindcss/vite** | 4.3.x | Tailwind v4 Vite plugin | Always (Tailwind v4 integration). |
| **@tanstack/react-table** | 8.21.x | Headless tables | Memory items list, runs list, flows list — server-side sort/filter/paginate via URL search params. |
| **lucide-react** | latest (icon set shadcn defaults to) | Icons | shadcn/ui default icon library. |
| **sonner** | 2.0.x | Toasts | Operator feedback (write/patch/delete/pin success/error). shadcn's recommended toast. |
| **zod** | 4.4.x | Runtime schema validation | Validate flow JSON in the editor; parse/narrow BFF responses. |
| **react-hook-form** | 7.77.x | Forms | Memory write/patch forms, flow create/edit. Pairs with zod resolver. |
| **@tanstack/react-query-devtools** | (matches Query 5.x) | Debug cache | Dev only. |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| **Vitest** 4.1.x | Unit/component tests | Vite-native test runner; reuses Vite config/transform. |
| **@testing-library/react** | Component testing | Standard with Vitest. |
| **ESLint + typescript-eslint** | Lint | Flat config. |
| **Go `net/http` + `httptest`** | BFF tests | Test SSE pass-through with `httptest.NewServer` emitting `text/event-stream`. |
## Installation
# Scaffold SPA
# Core data/routing
# SSE-over-POST client (mandatory — EventSource can't POST)
# Styling + UI (Tailwind v4)
# Forms / validation / toasts / icons
# Dev
## BFF vs Framework-Server Layer — Tradeoff Resolved
| Dimension | Go BFF + Vite SPA (recommended) | Next.js App Router server | TanStack Start | SvelteKit |
|-----------|--------------------------------|---------------------------|----------------|-----------|
| SSE proxy correctness | **Auto-flush for `text/event-stream`** (Go stdlib) | Documented buffering pitfalls; handler can buffer until return; needs `X-Accel-Buffering: no`, no compression, manual `ReadableStream` | Vite-based, viable but still JS-runtime streaming caveats | Viable but JS-runtime caveats |
| Ecosystem fit | **Native** — 3 backends already Go; shared idioms, one language for ops layer | New JS server runtime alongside Go services | New JS server | New JS server |
| Auth injection | Trivial `Rewrite`/`Director`; secrets in Go env | Route handlers / middleware | Server functions | hooks |
| Operational surface | One static bundle + one tiny Go binary | Node server to run/scale/patch | Node server | Node server |
| "Free BFF" value | N/A — proxy is ~100 lines of Go | Real, but buys problems here | Real, but unneeded | Real, but unneeded |
| SSR/SEO benefit | None needed (internal tool) | Wasted | Wasted | Wasted |
## SSE Through the BFF — Implications
- Native **`EventSource` is GET-only and cannot send custom headers or a request body** → unusable, because flowd run-stream and chat-stream are **POST**. Use **`@microsoft/fetch-event-source`** (`fetchEventSource`) which streams over `fetch`, supports POST + headers, manual retry/abort, and `onmessage`/`onerror` hooks.
- SSE streams are **not** managed by TanStack Query's cache. Drive them imperatively in an effect/hook (open on run-trigger, append events to local component state, close on `done`/unmount). Use TanStack Query only for the surrounding REST CRUD (start a run, then fetch `/runs/{id}` / `/runs/{id}/events` after the stream ends, invalidating the runs list).
- `httputil.ReverseProxy` auto-flushes for `Content-Type: text/event-stream` (incl. `;charset=utf-8`) — events reach the browser immediately, no batching.
- **Do not** wrap the proxy in any buffering/compression middleware on SSE routes (no gzip, no response-buffering logger). Buffering middleware turns the stream into a batch.
- If a fronting proxy (nginx/Traefik/ALB) ever sits in front of the BFF, ensure the upstream SSE response carries `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform`; pass these through unmodified.
- Add periodic **heartbeat/keep-alive** comments (`: ping\n\n`) on long-idle streams if any intermediary kills idle connections (~30–60s). Confirm whether flowd/chat already emit them; if not, the BFF can inject — but prefer not to rewrite the stream body, just pass through.
- Propagate client disconnects: cancel the upstream request when the browser aborts so flowd/chat don't keep running detached.
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Vite SPA + Go BFF | **Next.js App Router** (built-in BFF) | If you need SSR/SEO (you don't) or must ship a single JS artifact and will pay the SSE hardening cost. |
| Vite SPA + Go BFF | **TanStack Start** | If you want one TS codebase with isomorphic loaders/server-fns and accept a Node runtime next to the Go services. Cleaner SSE story than Next, but still unneeded here. |
| React | **SvelteKit** | If the team is Svelte-native; smaller bundles, built-in BFF endpoints. Loses React/shadcn/TanStack ecosystem depth that suits admin tooling. |
| shadcn/ui (Radix-based) | **Mantine** | If you want batteries-included tables/forms/notifications without wiring 5–8 packages — faster dashboard bootstrap, less design control. Strong second choice for an ops console. |
| shadcn/ui | **Raw Radix UI** | If you want primitives only and a fully bespoke design system (more upfront work). |
| TanStack Router | **React Router 7** (7.16.x) | If the team already knows React Router; mature, but less type-safety/search-param ergonomics than TanStack Router for greenfield. |
| @microsoft/fetch-event-source | **@fortaine/fetch-event-source** (3.0.6) | Was the maintained fork when MS package was dormant — but MS package was **republished 2026-04-23** (fork last touched 2023). Prefer upstream unless a specific fork fix is needed. |
| @microsoft/fetch-event-source | **`fetch()` + `ReadableStream` hand-rolled SSE parser** | If you want zero deps and full control; you re-implement event framing/retry. Reasonable given only 2 stream endpoints, but the library is small and battle-tested. |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Native **`EventSource`** | GET-only; can't send POST body or auth/`X-Tenant-Id` headers — both stream endpoints are POST | `@microsoft/fetch-event-source` (fetch-based) |
| **Next.js App Router as the BFF** | SSE buffering pitfalls (handler buffers until return; needs manual `ReadableStream`, disabled compression, `X-Accel-Buffering: no`); adds a Node runtime beside Go services; SSR wasted on internal tool | Thin Go `httputil.ReverseProxy` |
| **Browser → backend directly + CORS** | 3 distinct auth models, secret handling in browser, CORS on fixed backends you can't modify | Single-origin Go BFF (already a project constraint) |
| **gzip/response-buffering middleware on SSE routes** | Batches the stream, defeats live UX | Pass SSE routes through unbuffered |
| **TypeScript 6.0** (just released) | Too fresh for tooling alignment with current shadcn/Vite/TanStack; ecosystem types lag a major bump | TypeScript 5.9.x |
| **Redux / heavy global state for server data** | Over-engineered for cache/dedupe/invalidation of REST data | TanStack Query (server state) + local state for streams |
| **MUI / Ant Design** | Heavier runtime, opinionated theming, larger bundles vs. owned shadcn components | shadcn/ui (or Mantine if batteries-included desired) |
| **WebSockets** | Backends speak SSE; bidirectional not needed (server→client only) | SSE over fetch |
## Stack Patterns by Variant
- Vite + React 19 + TanStack Router/Query + shadcn/ui + Go BFF.
- Because it matches the internal-tooling standard and keeps the ops/auth plane in Go.
- Swap shadcn/ui → **Mantine** (built-in tables/forms/notifications/dark mode).
- Because every dashboard needs those, and Mantine ships them without per-feature package wiring.
- Revisit **TanStack Start** (Vite-based, cleaner SSE than Next) before Next.js.
- Because it keeps the Vite/TanStack ergonomics while adding a server layer — but budget for SSE flush hardening.
## Version Compatibility
| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| react 19.2.x | react-dom 19.2.x | Lockstep; required by current shadcn/ui & TanStack. |
| tailwindcss 4.3.x | @tailwindcss/vite 4.3.x | v4 uses `@tailwindcss/vite` plugin + `@import "tailwindcss"`; **not** the old `@tailwind` directives / PostCSS config. |
| shadcn CLI 3.x | React 19 + Tailwind v4 | Current shadcn components target both; older guides assuming Tailwind v3 are stale. |
| @tanstack/react-router 1.170.x | @tanstack/react-query 5.101.x | Designed to compose (router loaders prefetch into Query cache). |
| typescript | **pin 5.9.x, avoid 6.0.x** | 6.0 just released; let shadcn/Vite/TanStack/eslint type ecosystem catch up before adopting. |
| @microsoft/fetch-event-source 2.0.1 | fetch-capable browsers | Republished 2026-04-23; version string still 2.0.1 but actively maintained again. |
| Go httputil.ReverseProxy | Go 1.12+ (use 1.23+) | Auto `FlushInterval=-1` for `text/event-stream` landed long ago; modern Go also offers the `Rewrite` hook (replaces deprecated `Director`). |
## Sources
- npm registry (`npm view <pkg> version` / `time.modified`), 2026-06-03 — HIGH: vite 8.0.16, react 19.2.7, @tanstack/react-query 5.101.0, @tanstack/react-router 1.170.11, react-router 7.16.0, @tanstack/react-table 8.21.3, tailwindcss 4.3.0, @tailwindcss/vite 4.3.0, typescript 6.0.3 (avoid; pin 5.9), zod 4.4.3, vitest 4.1.8, react-hook-form 7.77.0, sonner 2.0.7, @microsoft/fetch-event-source 2.0.1 (modified 2026-04-23), @fortaine/fetch-event-source 3.0.6 (modified 2023-01-19).
- Context7 library resolution — HIGH: `/vitejs/vite`, `/tanstack/query`, `/reactjs/react.dev`, `/remix-run/react-router`, `/shadcn-ui/ui`.
- golang/go issues #27816, #41642, #47359 + Go stdlib reverseproxy source — HIGH: ReverseProxy streaming/`FlushInterval` behavior, auto `-1` for `text/event-stream`.
- Next.js streaming docs + vercel/next.js discussion #48427 + multiple SSE-in-Next writeups — MEDIUM: App Router SSE buffering pitfalls, `X-Accel-Buffering: no`, disable compression.
- MDN "Using server-sent events" + LogRocket "Fetch Event Source" + Azure/fetch-event-source repo — HIGH: `EventSource` GET-only limitation; fetch-based SSE for POST/headers.
- React UI library comparisons (Makers' Den, SaaSIndie, shadcn/ui docs Tailwind v4 + Vite install) 2025–2026 — MEDIUM: shadcn vs Mantine vs Radix tradeoffs; shadcn React 19 + Tailwind v4 support.
- Vite-vs-Next / TanStack Start comparisons (LogRocket, TanStack docs, DEV) 2025–2026 — MEDIUM: SPA-favors-Vite consensus for internal tools.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
