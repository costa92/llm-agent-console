# Phase 5: Health & Hardening - Research

**Researched:** 2026-06-04
**Domain:** BFF health aggregation (Go) + SSE reconnect state machine + five-state code-conformance audit (React/TS)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** **BFF aggregate `/api/health`.** A new BFF endpoint server-side probes all three services (flowd `/healthz`, chat `/healthz`, memory-gateway via a cheap reachability/`/metrics` probe — research picks the exact mechanism) and returns `{service: up|down|degraded|unknown, lastChecked}` per service. The SPA polls **ONE** endpoint. Centralizes the memory special-case + keeps the SPA simple. (A health handler, NOT a feature proxy.)
- **D-02:** **Cadence ~15s; states up / down / unknown (+ slow→degraded).** Poll every ~15s. **up** = probe 200; **down** = unreachable or non-2xx; **unknown** = pre-first-poll OR the `/api/health` call itself failed (stale — show last-checked); **degraded** (amber) only for a probe that succeeds but is **slow** (over a latency threshold — threshold is discretion). Lights the existing Phase-1 shell **HealthDots** — reuse, don't rebuild the visual.
- **D-03:** **Auto-reconnect with capped exponential backoff + jitter + manual retry.** On a transport drop (no terminal frame), auto-reconnect with exponential backoff + jitter, capped (exact attempts/max-delay = discretion, e.g. ~5 attempts / ~30s), showing a **"Reconnecting (n/N)…"** state; a manual Retry is always available; reconnection **STOPS on the terminal `done`/`error`** (no reconnect storms). Flow runs reconnect **hydrates `GET /runs/{id}/events` + de-dups** on `(kind,node,ordinal)` (the Phase-3 `retry()` seam). Chat re-opens the stream. **Extends** the Phase-3/4 `connection.ts` machine — extend, do NOT rewrite. A `flow_err`/chat `error` frame remains a terminal in-content error (NOT a transport drop → no reconnect).
- **D-04:** **Audit + fix gaps + add disconnected/reconnecting.** Audit every existing Memory/Flow/Chat view against the five-state contract and fix any gaps found, AND add the new SSE disconnected/reconnecting state on top for the stream views. Most surfaces already use `FiveStateWrapper` (Phases 2-4) — a targeted, evidence-driven retrofit, not a rewrite.

### Claude's Discretion
- The **memory-gateway reachability probe** mechanism (`/metrics` scrape vs minimal HEAD/GET) + per-service probe timeout + parallel-probe in the BFF handler.
- The exact **reconnect cap** (attempts + max delay) + backoff base + jitter formula.
- The **"slow" latency threshold** for degraded.
- Whether polling pauses on a hidden tab (visibility).
- The `/api/health` allowlist wiring in the BFF (BFF-owned route, not an upstream proxy).

### Deferred Ideas (OUT OF SCOPE)
- Deep metrics / Grafana-style dashboards (top-line health only).
- A degraded tier from `/readyz` (D-02 uses slow-probe for degraded, not readyz).
- Per-stream reconnect tuning UI (operator-configurable backoff) — cap is fixed.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHELL-02 | Operator sees **always-visible per-service health** (up/down/degraded) for memory-gateway, flowd, chat, polled on an interval, with a last-checked timestamp. | Slice A: BFF `/api/health` aggregate handler (§Architecture Patterns Pattern 1) probes the three verified endpoints (§Verified Upstream Health Endpoints) in parallel and maps to `up/down/degraded/unknown`; the SPA polls it via TanStack Query `refetchInterval≈15s` driving the existing `HealthDot.tsx` (Pattern 2). |

> Note: SHELL-02 is the only *requirement* ID, but the phase ALSO delivers the reconnect layer (D-03) and the five-state audit (D-04) per ROADMAP Phase 5 success criteria 2 & 3. Both are tracked as locked decisions, not separate REQ IDs.
</phase_requirements>

## Summary

This is the most cross-cutting phase: it touches the shell (live health dots), all three feature surfaces (five-state audit), the two stream hooks (reconnect), and adds one new BFF-owned Go route. There is **almost no new library work** — every dependency is already installed (TanStack Query, `@microsoft/fetch-event-source`, lucide-react, Go stdlib). The work is **extending executed code** (`HealthDot.tsx`, `connection.ts`, `ConnectionBadge.tsx`, `useRunStream.ts`, `useChatStream.ts`) and adding one parallel-probe Go handler in `internal/router`.

All four research targets were resolved against **real source** in the sibling repos and this repo's `internal/`:
1. **Health endpoints verified by reading the actual route tables** — flowd `GET /healthz` → `200 "ok"` text/plain; chat `GET /healthz` → `200 {"status":"ok"}` JSON; memory-gateway has **NO** `/healthz`/`/readyz` (confirmed: only `GET /metrics`, no auth) — so the cheapest reliable probe is **`GET /metrics` → check 200, do not parse the Prometheus body**.
2. **The BFF route pattern** is a `mux.HandleFunc("GET /api/health", …)` added in `internal/router/router.go` exactly like the existing `/api/config/env` and `/healthz` BFF-owned routes — reading the three base URLs already in `config.Config` (`MemoryBase`/`FlowBase`/`ChatBase`). It probes in parallel with a per-service timeout and is `httptest`-testable with fake upstreams.
3. **The reconnect extension** is purely additive to the `ConnState` union (`'idle'|'streaming'|'closed'|'errored'` → add `'reconnecting'`), exactly as `connection.ts`'s doc-comment anticipates. The terminal-wins guard is preserved. A **pure backoff scheduler** (separate, unit-testable) composes with the existing `useRunStream.retry()` (flow: hydrate+de-dup) and a fresh re-open (chat). The Phase-3/4 fake SSE emitter (`web/src/test/mocks/fetch-event-source.ts`) already supports `.fail()` (drop) → re-`emitOpen()` (resume), so the reconnect test reuses it.
4. **Five-state audit found three genuine candidate gaps**: `FlowsPage.tsx`, `RunDetailPage.tsx`, and `ChatPage.tsx` do **not** import `FiveStateWrapper` (verified by grep). These are the audit's primary targets — confirm each renders the five states (or delegates to a child that does) and fix any bare-blank-panel violations.

**Primary recommendation:** Two vertical slices. **Slice A** = BFF `/api/health` Go handler + live `HealthDot` polling hook. **Slice B** = the `reconnecting` state on `connection.ts` + a pure backoff scheduler + flow/chat reconnect wiring + `ConnectionBadge` arm + the overlay. The five-state audit fixes ride alongside Slice B (they share the stream-view surfaces).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Probe the 3 upstreams (parallel, timeout, status mapping) | API / Backend (Go BFF) | — | Centralizes the memory `/metrics` special-case + keeps secrets/internal URLs server-side; the SPA must not probe upstreams directly (single-origin constraint). |
| Poll `/api/health` on an interval + render dots | Browser / Client (SPA) | — | TanStack Query `refetchInterval`; pure presentation over the BFF DTO. |
| SSE reconnect (backoff loop, attempt counter, stop-on-terminal) | Browser / Client (SPA) | — | The stream is client-driven (`@microsoft/fetch-event-source` over `fetch`); the BFF reverse-proxy is stateless pass-through and has no reconnect role. |
| Flow event hydration on resume (`GET /runs/{id}/events`) | API / Backend (flowd, read-only) | Browser (de-dup in reducer) | flowd persists events; the client de-dups on `(kind,node,ordinal)`. |
| Five-state conformance | Browser / Client (SPA) | — | Pure presentation contract (`FiveStateWrapper`). |

## Standard Stack

**No new packages.** Every dependency this phase needs is already installed and verified in `PROJECT.md`'s STACK section.

### Core (already installed — reused)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @tanstack/react-query | 5.101.x | `/api/health` interval poll (`refetchInterval`) | Already the server-state layer; `refetchInterval` + `refetchIntervalInBackground:false` is the idiomatic poll. [CITED: PROJECT.md STACK] |
| @microsoft/fetch-event-source | 2.0.1 | SSE-over-fetch (POST) — the stream the reconnect layer drives | Already wraps both streams via `web/src/lib/sse.ts`. [CITED: PROJECT.md STACK] |
| lucide-react | latest | `Loader` (spin) icon for the `Reconnecting` badge arm | Already the icon set; `Loader`/`Unplug`/`Radio`/`CircleCheck` already used in `ConnectionBadge.tsx`. [VERIFIED: codebase grep] |
| Go stdlib (`net/http`, `context`, `sync`, `time`) | go 1.25.0 | Parallel probes with per-service timeout in `/api/health` | No HTTP client library needed — `http.Client{Timeout}` + goroutines + `sync.WaitGroup`. [VERIFIED: codebase grep go.mod] |

### Supporting (test-only, already installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | 4.1.x | Unit-test the backoff scheduler + extended `connReducer` + reconnect-resume | TS test runner already configured (`vitest.config.ts` present). [VERIFIED: codebase grep] |
| @testing-library/react | installed | `HealthDot` poll test with mocked `/api/health` | Already used across feature tests. [VERIFIED: codebase grep] |
| Go `net/http/httptest` | stdlib | `/api/health` handler test with fake upstreams (down + slow/degraded) | Already the BFF test pattern (`internal/router/router_test.go`, `internal/proxy/*_test.go`). [VERIFIED: codebase grep] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@microsoft/fetch-event-source`'s built-in retry | The library's own auto-retry | REJECTED — the console drives SSE through the `openSseStream` wrapper with manual `onError` (no auto-retry); reconnect must compose with the flow hydrate+de-dup seam and the `connReducer`, which the library's opaque retry cannot do. Hand-roll the backoff loop over the existing seam. |
| memory `/metrics` 200-check | A minimal HEAD request | `/metrics` does not register a HEAD handler (`mux.Handle("GET /metrics", …)` — method-specific in Go 1.22+ ServeMux). A HEAD would 405. Use **`GET /metrics`, read status only, discard body** (or use a small/`MaxBytesReader`). [VERIFIED: codebase grep memory-gateway router] |

**Installation:** None. (`go.mod` and `web/package.json` unchanged.)

## Package Legitimacy Audit

> Not applicable — this phase installs **zero** new packages. All libraries (TanStack Query, `@microsoft/fetch-event-source`, lucide-react, Vitest, Go stdlib) are already present and verified in `PROJECT.md`'s STACK section. No registry/slopcheck pass required.

## Verified Upstream Health Endpoints

> All three verified by reading the **actual route tables and handler bodies** in the sibling repos (under `/home/hellotalk/code/go/src/github.com/costa92/llm-agent-ecosystem/`). The siblings are read-only — do NOT modify them.

| Service | Console base (config key) | Probe path | Method | Success signal | Auth | Source (verified) |
|---------|--------------------------|------------|--------|----------------|------|-------------------|
| **flowd** | `cfg.FlowBase` (`:7861`) | `/healthz` | `GET` | `200`, body `ok` (text/plain) | none — `/healthz` is an explicit auth bypass | `llm-agent-flow/cmd/flowd/server/server.go:108` (`mux.HandleFunc("GET /healthz", healthHandler)`) + `:168` (`healthHandler` writes `"ok"`); `cmd/flowd/server/auth.go:74` (`path == "/healthz"` bypass) [VERIFIED: codebase grep] |
| **chat** | `cfg.ChatBase` (`:8081` per config) | `/healthz` | `GET` | `200`, body `{"status":"ok"}` (JSON) | none | `llm-agent-customer-support/internal/httpapi/httpapi.go:60` (`mux.Handle("/healthz", …)`) + `:204` (`handleHealth` → `writeJSON(w, 200, {"status":"ok"})`) [VERIFIED: codebase grep] |
| **memory-gateway** | `cfg.MemoryBase` (`:8080`) | `/metrics` | `GET` | `200` (Prometheus text — **do NOT parse**, status only) | none — `/metrics` registered via the extras callback, only `withRequestID` wraps the mux (no auth middleware; auth is per-handler `readAuthoritativeScope`, not on `/metrics`) | `llm-agent-memory-gateway/cmd/memory-gateway/main.go:254` (`mux.Handle("GET /metrics", metrics.Handler())`); `internal/transport/router.go:17` `NewHandler` route table confirms **NO** `/healthz`/`/readyz`; grep for `healthz|readyz` in non-test memory-gateway source returns **empty** [VERIFIED: codebase grep] |

**Memory probe decision (Claude's discretion, D-01):** `GET /metrics`, treat **any 200 as up**, drain/discard the body (it is full Prometheus text — never parse it for health). Do not use HEAD (would 405 — Go 1.22+ method-specific `ServeMux`). This is the cheapest reliable reachability probe; memory-gateway has no dedicated liveness endpoint by design.

**chat `/readyz` is NOT used** for the degraded tier (D-02 / Deferred): degraded comes from probe *slowness*, not readiness. Probe chat with `/healthz` only.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌──────────────────────────── BROWSER (SPA) ───────────────────────────┐
                         │                                                                        │
  TanStack Query         │   useServiceHealth()  ──poll every ~15s──▶  GET /api/health           │
  refetchInterval≈15s    │        │                                          │ (single origin)   │
  refetchIntervalInBg    │        ▼                                          │                   │
  = false (pause hidden) │   {memory,flow,chat}:{status,lastChecked,latencyMs?}                  │
                         │        │                                          │                   │
                         │        ▼                                          │                   │
                         │   <HealthDot status=… />  (TopBar, existing visual)                   │
                         │                                                                        │
                         │   ── stream views (flow timeline / chat) ──────────────────────────┐  │
                         │   useRunStream / useChatStream                                      │  │
                         │     openSseStream ──POST──▶ /api/flow|chat (SSE proxy) ─────────────┼──┼─┐
                         │       onError (drop, no terminal)                                   │  │ │
                         │         ▼                                                           │  │ │
                         │   connReducer: streaming ─drop─▶ RECONNECTING(n/N) ─success─▶ streaming  │ │
                         │         │   backoffScheduler (pure): delay = jitter(min(cap, base·2^n))  │ │
                         │         ├─ cap exhausted ─▶ errored ("Connection lost", manual Retry)    │ │
                         │         └─ terminal done/err ─▶ closed  (terminal ALWAYS wins)           │ │
                         │   flow resume: retry() → GET /runs/{id}/events → reducer de-dups         │ │
                         │   chat resume: re-open chatStream (no de-dup — Phase-4 contract)         │ │
                         └────────────────────────────────────────────────────────────────────────┘ │
                                                                                                      │
  ┌───────────────────────────────── GO BFF (this repo, internal/) ────────────────────────────────┐ │
  │  router.go:  mux.HandleFunc("GET /api/health", healthAggregateHandler(cfg))   [NEW, BFF-owned]  │ │
  │     │   probes all 3 IN PARALLEL (goroutines + WaitGroup), per-service http.Client{Timeout}     │ │
  │     ├──▶ GET {FlowBase}/healthz     → 200 ⇒ up ; slow ⇒ degraded ; err/non-2xx ⇒ down           │ │
  │     ├──▶ GET {ChatBase}/healthz     → 200 ⇒ up ; …                                              │ │
  │     └──▶ GET {MemoryBase}/metrics   → 200 ⇒ up (status only, body discarded) ; …                │ │
  │  reverse-proxy directors (existing, unchanged): /api/memory /api/flow /api/chat  ◀──────────────┼─┘
  └────────────────────────────────────────────────────────────────────────────────────────────────┘
            │ GET /healthz          │ GET /healthz          │ GET /metrics
            ▼                       ▼                       ▼
        flowd :7861            chat :8081            memory-gateway :8080   (sibling repos, read-only)
```

### Recommended Project Structure (new/changed files)
```
internal/
  router/
    router.go            # ADD: mux.HandleFunc("GET /api/health", healthAggregateHandler(cfg))
    health.go            # NEW: healthAggregateHandler + probe logic + DTO (or inline in router.go)
    health_test.go       # NEW: httptest fake upstreams (up / down / slow-degraded)
web/src/
  components/shell/
    HealthDot.tsx        # UNCHANGED visual; status now driven by live data
    TopBar.tsx           # CHANGE: replace status="unknown" literals with useServiceHealth()
  features/health/       # NEW (or co-locate under shell/)
    useServiceHealth.ts  # NEW: TanStack Query poll of /api/health
    health.test.ts       # NEW: poll test w/ mocked /api/health
  features/flow/timeline/
    connection.ts        # EXTEND: add 'reconnecting' + reconnect events (additive)
    connection.test.ts   # EXTEND: reconnecting transitions
    backoff.ts           # NEW: pure capped-exponential-backoff-with-jitter scheduler
    backoff.test.ts      # NEW: deterministic (injected RNG) — sequence, cap, reset
    useRunStream.ts      # EXTEND: drive reconnect loop on transport-error (flow hydrate+de-dup)
  features/chat/turns/
    useChatStream.ts     # EXTEND: drive reconnect loop on transport-error (chat re-open)
  features/flow/components/
    ConnectionBadge.tsx  # EXTEND: add the 'reconnecting' arm (amber, spinner, "Reconnecting (n/N)…")
```

### Pattern 1: BFF parallel-probe `/api/health` handler (Go, httptest-testable)

**What:** A BFF-owned route (not a proxy) that probes the three upstreams concurrently with a per-service timeout and maps each to `up|down|degraded|unknown`, returning a JSON DTO. Mirrors the existing `configEnvHandler(cfg)` closure pattern.

**When to use:** Slice A. Mount with `mux.HandleFunc("GET /api/health", healthAggregateHandler(cfg))` next to the existing `GET /api/config/env` in `router.go`. It sits **inside** the `MiddlewareOperatorAuth` wrap like every other route (the existing `/healthz` and `/api/config/env` already do — operator token is empty/disabled in dev).

**DTO (the contract the SPA consumes — matches `HealthDot`'s `HealthService = 'memory'|'flow'|'chat'`):**
```jsonc
// GET /api/health  →  200
{
  "services": {
    "memory": { "status": "up",       "lastChecked": "2026-06-04T10:00:00Z", "latencyMs": 12 },
    "flow":   { "status": "degraded", "lastChecked": "2026-06-04T10:00:00Z", "latencyMs": 1840 },
    "chat":   { "status": "down",     "lastChecked": "2026-06-04T10:00:00Z" }
  }
}
```
> Either a `{services:{…}}` map or a `{services:[…]}` array is fine; a **map keyed by service** is simplest for the SPA (direct `data.services.flow.status` → `HealthDot status`). Pick one and lock it in the plan.

**Example (the Go shape — verified against the existing `router.go` patterns):**
```go
// Source: pattern from internal/router/router.go configEnvHandler + Go stdlib
// (verified existing file). [VERIFIED: codebase grep]

type serviceHealth struct {
    Status      string `json:"status"`               // up|down|degraded|unknown
    LastChecked string `json:"lastChecked"`
    LatencyMs   int64  `json:"latencyMs,omitempty"`
}

type probe struct {
    name string // "memory"|"flow"|"chat"
    url  string // e.g. cfg.MemoryBase + "/metrics"
}

func healthAggregateHandler(cfg *config.Config) http.HandlerFunc {
    // Per-service timeout (discretion): ~3s. degraded threshold (discretion): ~1s.
    const perProbeTimeout = 3 * time.Second
    const degradedAbove   = 1 * time.Second

    return func(w http.ResponseWriter, r *http.Request) {
        probes := []probe{
            {"flow",   cfg.FlowBase + "/healthz"},
            {"chat",   cfg.ChatBase + "/healthz"},
            {"memory", cfg.MemoryBase + "/metrics"}, // status only — never parse body
        }
        results := make(map[string]serviceHealth, len(probes))
        var mu sync.Mutex
        var wg sync.WaitGroup
        now := time.Now().UTC().Format(time.RFC3339)

        for _, p := range probes {
            wg.Add(1)
            go func(p probe) {
                defer wg.Done()
                status, latency := probeOne(r.Context(), p.url, perProbeTimeout, degradedAbove)
                sh := serviceHealth{Status: status, LastChecked: now}
                if latency >= 0 {
                    sh.LatencyMs = latency.Milliseconds()
                }
                mu.Lock(); results[p.name] = sh; mu.Unlock()
            }(p)
        }
        wg.Wait()

        w.Header().Set("Content-Type", "application/json")
        w.Header().Set("Cache-Control", "no-store")
        w.WriteHeader(http.StatusOK)
        _ = json.NewEncoder(w).Encode(map[string]any{"services": results})
    }
}

// probeOne returns ("up"|"down"|"degraded", latency) — never leaks the upstream
// URL or error string (SECURITY: §Security Domain). A 2xx + slow ⇒ degraded.
func probeOne(ctx context.Context, url string, timeout, degradedAbove time.Duration) (string, time.Duration) {
    ctx, cancel := context.WithTimeout(ctx, timeout)
    defer cancel()
    req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
    start := time.Now()
    resp, err := http.DefaultClient.Do(req) // or a shared client w/ Timeout
    latency := time.Since(start)
    if err != nil {
        return "down", -1 // do NOT echo err.Error() to the client
    }
    defer resp.Body.Close()
    _, _ = io.Copy(io.Discard, resp.Body) // drain (memory /metrics body), never parse
    if resp.StatusCode < 200 || resp.StatusCode >= 300 {
        return "down", latency
    }
    if latency > degradedAbove {
        return "degraded", latency
    }
    return "up", latency
}
```

> **`unknown` is a CLIENT-side state, not a server one.** The BFF only ever returns `up|down|degraded`. `unknown` is what the SPA shows **pre-first-poll** OR when the `/api/health` call itself fails (see Pattern 2 / D-02). The handler never returns `unknown`.

### Pattern 2: Live HealthDot poll hook (TanStack Query, client)

**What:** One `useQuery` that polls `/api/health` and feeds each service's status into the existing `<HealthDot status=… />` in `TopBar.tsx`.

**Example:**
```ts
// Source: TanStack Query refetchInterval idiom + existing TopBar fetchEnv pattern.
// [CITED: PROJECT.md STACK; VERIFIED: TopBar.tsx codebase grep]
type HealthDTO = { services: Record<'memory'|'flow'|'chat',
  { status: 'up'|'down'|'degraded'; lastChecked: string; latencyMs?: number }> }

export function useServiceHealth() {
  const q = useQuery({
    queryKey: ['service-health'],
    queryFn: async (): Promise<HealthDTO> => {
      const res = await fetch('/api/health')
      if (!res.ok) throw new Error(`${res.status}`)
      return res.json()
    },
    refetchInterval: 15_000,            // D-02 ~15s
    refetchIntervalInBackground: false, // discretion: pause on hidden tab (default)
    refetchOnWindowFocus: true,         // discretion: fresh on return
  })
  // Map to the dot props: pre-first-poll OR poll-itself-failed ⇒ 'unknown' + stale lastChecked.
  // (q.isPending → unknown/Checking…; q.isError → keep last data's lastChecked, force status 'unknown')
  return q
}
```
> **Stale-on-self-failure (D-02, critical):** when the aggregate poll errors (`q.isError`), do NOT blank the dots or flip them green — render `unknown` and keep the last-known `lastChecked` ("Checked … ago — health check unavailable"). TanStack Query keeps `q.data` from the last success; read `lastChecked` from there while forcing the displayed status to `unknown`.

### Pattern 3: The `reconnecting` connection-state extension (additive)

**What:** Extend the `ConnState` union and `connReducer` in `connection.ts`. The file's doc-comment already declares this is the intended extension point.

**Current (verified):**
```ts
// web/src/features/flow/timeline/connection.ts (executed) [VERIFIED: codebase grep]
export type ConnState = 'idle' | 'streaming' | 'closed' | 'errored'
export type ConnEvent =
  | { type: 'start' } | { type: 'terminal' }
  | { type: 'transport-error' } | { type: 'reset' }
```

**Extension shape (the contract, not final code):**
```ts
export type ConnState = 'idle' | 'streaming' | 'reconnecting' | 'closed' | 'errored'
export type ConnEvent =
  | { type: 'start' } | { type: 'terminal' } | { type: 'reset' }
  | { type: 'transport-error' }      // streaming → reconnecting (NOW starts retry, not immediate errored)
  | { type: 'reconnect-success' }    // reconnecting → streaming
  | { type: 'reconnect-give-up' }    // reconnecting → errored (cap exhausted)

// Guard contract (preserve the existing terminal-wins rule):
//   'terminal' from ANY non-idle state → 'closed'  (wins even mid-reconnect — D-03 no storms)
//   'transport-error' while 'closed'    → 'closed'  (existing terminal-then-error guard)
//   'transport-error' while 'streaming' → 'reconnecting'   (was → 'errored')
//   'reconnect-success'                 → 'streaming'
//   'reconnect-give-up'                 → 'errored'
```
> **CRITICAL — backward-compat for chat:** today BOTH `useRunStream` and `useChatStream` dispatch `{type:'transport-error'}` and expect it to land in `'errored'`. After the extension it lands in `'reconnecting'`. The reconnect loop (Pattern 4) must own the transition to `'errored'` via `reconnect-give-up`. Confirm `useChatStream`'s existing `errored`-reading UI (`ChatPage.tsx` reads `conn === 'errored'` for the dropped-transport markers — verified) still reaches `errored` after the cap. This is the load-bearing seam — do not let `transport-error` strand chat in `reconnecting` forever with no loop.

### Pattern 4: Pure backoff scheduler + reconnect loop (testable seam)

**What:** A **pure** function `nextDelay(attempt, opts, rng)` (no timers, no `Date.now`) so the schedule is deterministic in tests; the timer-driving loop lives in the hook.

**Recommended numbers (D-03 discretion, from UI-SPEC):** base 1s, factor 2, maxDelay 30s, cap N=5, **full-jitter**: `delay = rng() * min(maxDelay, base * 2^attempt)`.

**Example:**
```ts
// Source: AWS "Exponential Backoff And Jitter" full-jitter formula (industry standard).
// [ASSUMED: training knowledge of full-jitter; formula is well-established]
export type BackoffOpts = { baseMs: number; factor: number; maxMs: number; cap: number }
export function nextDelay(attempt: number, o: BackoffOpts, rng = Math.random): number {
  const ceiling = Math.min(o.maxMs, o.baseMs * o.factor ** attempt)
  return Math.floor(rng() * ceiling) // full jitter
}
// The hook: on transport-error → dispatch reconnect-start; loop attempt=1..cap:
//   setTimeout(nextDelay(attempt, opts)); on fire → retry() (flow) / re-open (chat).
//   success → reconnect-success (resume). attempt > cap → reconnect-give-up → errored.
//   manual Retry → reset attempt counter + fire immediately. terminal → stop loop.
```

**Flow vs chat resume (D-03 / IC-3 — both verified against executed hooks):**
- **Flow** (`useRunStream.ts:149 retry()`, verified): if `runId` known → `listRunEvents(runId)` (= `GET /runs/{id}/events`) folded as `source:'history'`; the reducer de-dups on `(kind,node,ordinal)` (`reducer.ts:12` verified) so the resume is lossless and duplicate-free. The reconnect loop calls this same `retry()` on a timer. If `runId` NOT yet known (drop before `X-Run-ID`) → re-open `runStream` (a genuinely new attempt — acceptable, no run was created).
- **Chat** (`useChatStream.ts`, verified): no `seq`/ordinals (Phase-4 contract) → reconnect **re-opens** `chatStream`. A re-open may re-emit steps; the chat reducer has no de-dup (acceptable per Phase-4 D-05, or the planner gates re-open). This is a planner decision, not a visual one.

### Pattern 5: The reconnect overlay (transient, on TOP of five states)

**What:** The `ConnectionBadge` gets a `reconnecting` arm; a muted subline appears under the partial timeline/trace. The partial content **stays visible** (it is `ready` content). This is NOT a five-state replacement — it composes on top.

**ConnectionBadge extension (verified current file has 3 arms in `STATE_META`):**
```ts
// Add to STATE_META (ConnectionBadge.tsx, verified). [VERIFIED: codebase grep]
reconnecting: {
  token: 'var(--status-degraded)',  // AMBER (shares recoverable-transport amber)
  label: 'Reconnecting',            // rendered as "Reconnecting (n/N)…" with the counter
  Icon: Loader,                     // SPINNER (animate-spin) — distinguishes from static Unplug "Connection lost"
}
```
> **Operator-critical distinction (UI-SPEC):** `reconnecting` = amber **+ spinner + (n/N) counter** (in-progress). `errored`/"Connection lost" = amber **+ static Unplug, no counter** (gave up). The badge currently animates the spinner only for `streaming` (`conn === 'streaming' ? animate-spin`) — extend that ternary to spin for `reconnecting` too. The `(n/N)` counter is a NEW prop the badge needs (e.g. `attempt`/`cap`), since `ConnState` alone can't carry it.

### Anti-Patterns to Avoid
- **Reconnecting on a content error:** a `flow_err` / chat `error` frame is a **terminal** (→ `closed` + red in-content frame). It must NEVER enter `reconnecting`. Only a transport drop with **no** terminal frame does (D-03). The existing `onFrame` already routes `flow_err`/`flow_done` → `terminal` (verified) — keep that; the reconnect loop only triggers off `transport-error`.
- **Reconnect storms:** a `terminal` arriving mid-reconnect (e.g. flow finished server-side) must settle `closed` and stop the loop. Preserve "terminal always wins."
- **Parsing the memory `/metrics` body:** never parse Prometheus text for health — status code only.
- **Blanking dots on poll failure:** show `unknown` + stale last-checked, never blank/green.
- **Leaking upstream URLs/errors to the browser** in `/api/health` (see §Security Domain).
- **Rewriting `connection.ts` / `ConnectionBadge.tsx`:** extend additively — every existing caller (flow timeline, chat, RunDetail) reads `ConnState` and must keep compiling.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Interval polling + dedupe + stale-while-error | A `setInterval` + manual state | TanStack Query `refetchInterval` | Already the server-state layer; gives stale-data retention on error for free (needed for stale last-checked). |
| SSE-over-POST + abort | A `fetch` + `ReadableStream` parser | `openSseStream` (existing `@microsoft/fetch-event-source` wrapper) | Already battle-tested across Phase 3/4; reconnect drives it, doesn't replace it. |
| Connection state | A new boolean/enum | EXTEND the existing `connReducer` typed union | Designed to extend; every caller already consumes `ConnState`. |
| Parallel HTTP probes | A custom worker pool | goroutines + `sync.WaitGroup` + `http.Client{Timeout}` / `context.WithTimeout` | Go stdlib; the `httptest` test pattern already exists in the repo. |
| Backoff timing | Ad-hoc `setTimeout` doubling inline | A **pure** `nextDelay(attempt,…,rng)` + the hook owns the timer | Purity makes the schedule unit-testable deterministically (inject `rng`). |

**Key insight:** This phase is ~90% extension of executed, well-factored code. The two `connection.ts` and `ConnectionBadge.tsx` doc-comments literally say "Phase 5 adds 'reconnecting'." Resist any urge to refactor.

## Runtime State Inventory

> This phase has no rename/refactor/migration component — it ADDS a route and EXTENDS state machines. No stored data, live-service config, OS-registered state, secrets/env, or build artifacts are renamed or migrated.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no datastore keys/collections renamed. | None — verified: phase adds a read-only probe + client state only. |
| Live service config | None — the 3 base URLs already exist in `config.Config` (`MemoryBase`/`FlowBase`/`ChatBase`, verified); `/api/health` reads them, adds none. | None. |
| OS-registered state | None — no scheduler/daemon/process registration. | None. |
| Secrets/env vars | None — health upstreams are auth-none; no new secret keys. `/api/health` reads only the non-secret base URLs. | None. |
| Build artifacts | None — no package rename; `go.mod`/`package.json` unchanged (no new deps). | None. |

## Common Pitfalls

### Pitfall 1: `transport-error` now lands in `reconnecting`, breaking chat's `errored` UI
**What goes wrong:** After extending `connReducer`, `useChatStream`'s `dispatchConn({type:'transport-error'})` lands in `reconnecting`, but `ChatPage.tsx` reads `conn === 'errored'` for the dropped-transport markers (verified at `ChatPage.tsx:184`). Chat could strand in `reconnecting` and never show "Connection lost."
**Why it happens:** The transition that used to be terminal (`transport-error → errored`) becomes intermediate.
**How to avoid:** The reconnect loop MUST own reaching `errored` via `reconnect-give-up` at cap. Wire the loop into BOTH hooks (flow AND chat) in the same slice; do not ship the `connReducer` change without the loop.
**Warning signs:** chat shows a spinner that never resolves after a drop; `ChatPage` markers (`droppedTransport`) never fire.

### Pitfall 2: memory `/metrics` probe times out and shows `down` under load
**What goes wrong:** `/metrics` renders the full Prometheus registry; under high cardinality it can be slow, tripping the degraded/down threshold spuriously.
**Why it happens:** `/metrics` is not a liveness endpoint; it does real work.
**How to avoid:** Keep the per-service timeout generous (~3s), the degraded threshold reasonable (~1s), and **discard the body without reading it fully into memory** (`io.Copy(io.Discard, …)`, optionally `MaxBytesReader`). Document that memory's latency is `/metrics`-render time, not a pure ping — its "degraded" is noisier than flow/chat. Acceptable for top-line health.
**Warning signs:** memory dot flaps amber/red while the service is healthy.

### Pitfall 3: `/api/health` leaks internal upstream URLs or error strings
**What goes wrong:** Echoing `err.Error()` or the probe URL into the JSON response exposes `http://memory-gateway:8080/...` and internal failure detail to the browser.
**Why it happens:** Convenient debugging fields left in the DTO.
**How to avoid:** The DTO carries ONLY `status` (+ `lastChecked`, optional `latencyMs`). Never the URL, never the raw error. (See §Security Domain.) The existing `configEnvHandler` DOES expose base URLs — but that's SHELL-04's deliberate non-secret targeting display; `/api/health` should NOT re-expose them per-probe-error.
**Warning signs:** any `url`/`error`/`detail` field in the `/api/health` response body.

### Pitfall 4: reconnect loop leaks timers / fires after unmount or terminal
**What goes wrong:** `setTimeout`-driven retries keep firing after the component unmounts, the stream reaches terminal, or the operator hits Stop.
**Why it happens:** The timer isn't cleared on the state transitions that end reconnection.
**How to avoid:** Store the timer id in a ref; clear it on `terminal`, `reconnect-success`, unmount, `reset`, and manual Stop. The existing hooks already abort on unmount (`useEffect(() => () => abortRef.current?.abort())`, verified) — add the timer clear alongside.
**Warning signs:** network tab shows reconnect attempts after a run finished; React "state update on unmounted component" warnings.

### Pitfall 5: full-jitter with `attempt` starting at 0 vs 1 (off-by-one on the cap)
**What goes wrong:** The `(n/N)` counter and the cap disagree depending on whether the first attempt is 0 or 1.
**Why it happens:** `base * factor ** attempt` differs for `attempt=0` (delay=base·rng) vs `attempt=1`.
**How to avoid:** Decide the convention once (recommend: attempt counter shown as `1..N`, internal `attempt` index `0..N-1` into `nextDelay`). Unit-test the boundary: attempt N exhausts → `reconnect-give-up`.
**Warning signs:** badge shows "Reconnecting (6/5)…" or gives up one attempt early/late.

## Code Examples

### Extended `connReducer` test (extends the existing `connection.test.ts`)
```ts
// Source: extends web/src/features/flow/timeline/connection.test.ts (verified pattern).
// [VERIFIED: codebase grep — existing run() helper + describe blocks]
it('drop → reconnecting → success → streaming', () => {
  expect(run([
    { type: 'start' }, { type: 'transport-error' }, { type: 'reconnect-success' },
  ])).toBe('streaming')
})
it('drop → cap exhausted → errored', () => {
  expect(run([
    { type: 'start' }, { type: 'transport-error' }, { type: 'reconnect-give-up' },
  ])).toBe('errored')
})
it('terminal wins mid-reconnect → closed (no storm)', () => {
  expect(run([
    { type: 'start' }, { type: 'transport-error' }, { type: 'terminal' },
  ])).toBe('closed')
})
```

### Reconnect-resume-with-dedup test (reuses the fake SSE emitter)
```ts
// Source: web/src/test/mocks/fetch-event-source.ts makeFakeSseStream (verified —
// supports .fail() drop + re-emitOpen() resume + emit(frames)). [VERIFIED: codebase grep]
const fake = makeFakeSseStream()
vi.mock('@/lib/sse', () => ({ openSseStream: fake.openSseStream }))
// 1. open, emit a prefix, then DROP:
await fake.emitOpen({ 'X-Run-ID': 'run_42' })
fake.emit(goldenSuccess.slice(0, 2))   // flow_started, node_started
await fake.fail()                       // transport drop → onError → reconnecting(1/N)
// 2. assert conn === 'reconnecting' and the (n/N) progression
// 3. the loop fires retry() → listRunEvents('run_42') (mock it returning the prefix+tail)
//    → reducer de-dups (kind,node,ordinal) → timeline has each event ONCE
// 4. emit terminal → conn 'closed', loop stops
```

### Go `/api/health` handler test (httptest fake upstreams)
```go
// Source: pattern from internal/router/router_test.go + internal/proxy/*_test.go
// (verified httptest usage). [VERIFIED: codebase grep]
func TestHealthAggregate(t *testing.T) {
    up    := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) }))
    down  := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(503) }))
    slow  := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { time.Sleep(1500*time.Millisecond); w.WriteHeader(200) }))
    defer up.Close(); defer down.Close(); defer slow.Close()
    cfg := &config.Config{FlowBase: up.URL, ChatBase: down.URL, MemoryBase: slow.URL}
    // GET /api/health → flow:up, chat:down, memory:degraded (slow>threshold)
    // ALSO assert: response body contains NO upstream URL / NO error string (security).
}
```
> Run Go tests with **`GOWORK=off go test ./...`** (project requires `GOWORK=off` — CLAUDE.md / umbrella polyrepo convention; the sibling-repo workspace would otherwise interfere).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Immediate `errored` on transport drop (Phase 3/4) | `streaming → reconnecting → (streaming\|errored)` with capped backoff | This phase | Drops become recoverable; "Connection lost" is now reached after N silent retries, not immediately. |
| `HealthDot status="unknown"` literals in `TopBar` (Phase 1) | Live status from `/api/health` poll | This phase | Dots reflect real service health. |
| Native `EventSource` reconnect (GET-only, opaque) | Hand-rolled loop over `@microsoft/fetch-event-source` (POST, composes with hydrate+de-dup) | Established Phase 3 | Required because both streams are POST and need de-dup-aware resume. |

**Deprecated/outdated:** none introduced.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Full-jitter formula `rng()*min(maxMs, base*factor^attempt)` is the right backoff (vs equal/decorrelated jitter) | Pattern 4 | LOW — any capped jitter satisfies D-03; full-jitter is a safe default. Tunable. |
| A2 | Recommended numbers base 1s / factor 2 / maxDelay 30s / cap 5 | Pattern 4 | LOW — UI-SPEC recommends these; explicitly planner-tunable, cap fixed. |
| A3 | ~3s per-service timeout, ~1s degraded threshold | Pattern 1 | LOW — Claude's discretion (D-02); tune against real latencies. memory `/metrics` may need a higher degraded threshold (Pitfall 2). |
| A4 | chat base URL is `:8081` | Verified Endpoints table | LOW — from `config.go` comment "ChatBase (D-03: :8081)"; the actual value is whatever the YAML config sets. The handler reads `cfg.ChatBase` regardless. |
| A5 | A DTO keyed by service name (map) over an array | Pattern 1 | LOW — cosmetic; either works. Lock one in the plan. |

## Open Questions (RESOLVED)

> Disposition: both resolved in the plans. OQ#1 → RESOLVED (Plan 05-03): chat is **manual-retry-only** on a transport drop (flow auto-reconnects with /events de-dup; chat avoids duplicating the answer) — documented as a deliberate D-03 refinement. OQ#2 → RESOLVED (Plan 05-01): a single ~1s degraded threshold with memory's `/metrics` latency documented as the noisier signal.

1. **Chat re-open re-emits steps (no de-dup) — accept or gate?** — RESOLVED (Plan 05-03): gate chat to manual-retry-only; flow keeps auto-reconnect.
   - What we know: chat has no `seq`/ordinals (Phase-4 contract); a reconnect re-opens and may duplicate steps in the trace.
   - What's unclear: whether the planner accepts visible duplication or gates chat auto-reconnect (e.g. only manual Retry for chat, auto for flow).
   - Recommendation: accept per Phase-4 D-05 (the trace is informational); if duplication looks bad, gate chat to manual-Retry-only and keep auto-reconnect for flow (which de-dups). Decide in the plan.

2. **memory `/metrics` latency noise for the degraded tier.**
   - What we know: `/metrics` does real work; its latency ≠ a ping.
   - What's unclear: whether to apply a higher degraded threshold for memory specifically.
   - Recommendation: a per-service degraded threshold (memory higher) OR document that memory degraded is noisier. Planner call.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Go toolchain | BFF `/api/health` handler + test | ✓ (assumed — repo is Go, `go.mod` go 1.25.0) | 1.25.0 | — |
| Node + Vitest | TS extensions + tests | ✓ (assumed — `vitest.config.ts` present, web/ built in Phases 1-4) | Vitest 4.1.x | — |
| Live sibling services (flowd/chat/memory) | RUNTIME health probing only | n/a for dev/test | — | Tests use `httptest` fake upstreams + the fake SSE emitter — NO live backend needed (per CONTEXT specifics). |

**Missing dependencies with no fallback:** none — all unit/integration tests run without live backends.
**Missing dependencies with fallback:** live services are only needed for manual end-to-end verification, not for the automated suite.

> Note: I could not run `go version`/`node --version` to confirm exact installed toolchain versions in this research session (probes not executed). The repo's `go.mod` declares `go 1.25.0` and `vitest.config.ts` exists — both [VERIFIED: codebase grep]. The planner should confirm the toolchain is on PATH before Slice A.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (TS) | Vitest 4.1.x + @testing-library/react |
| Framework (Go) | `go test` + `net/http/httptest` |
| Config file | `web/vitest.config.ts` (present); Go: standard `_test.go` |
| Quick run command | `cd web && npx vitest run src/features/flow/timeline src/features/health` · `GOWORK=off go test ./internal/router/` |
| Full suite command | `cd web && npx vitest run` · `GOWORK=off go test ./...` |

### Phase Requirements → Test Map
| Req/Decision | Behavior | Test Type | Automated Command | File Exists? |
|------|----------|-----------|-------------------|-------------|
| SHELL-02 / D-01 | `/api/health` probes 3 upstreams in parallel; up/down/degraded mapping | Go unit (httptest) | `GOWORK=off go test ./internal/router/ -run Health` | ❌ Wave 0 (`internal/router/health_test.go`) |
| SHELL-02 / D-02 | HealthDot polls `/api/health`, shows status + stale-on-self-failure | TS component | `npx vitest run src/features/health` | ❌ Wave 0 (`useServiceHealth` + test) |
| D-03 | `connReducer` reconnecting transitions (drop→reconnecting→streaming; cap→errored; terminal wins) | TS unit | `npx vitest run src/features/flow/timeline/connection.test.ts` | ✅ extend existing |
| D-03 | backoff scheduler: sequence, cap, jitter bound, reset | TS unit | `npx vitest run src/features/flow/timeline/backoff.test.ts` | ❌ Wave 0 (`backoff.ts` + test) |
| D-03 | reconnect-resume preserves flow de-dup invariant (drop → reconnecting(n/N) → resume) | TS integration (fake emitter) | `npx vitest run src/features/flow/timeline` | ❌ Wave 0 (reuse `makeFakeSseStream`) |
| D-03 | cap-exhausted → errored "Connection lost" (flow + chat) | TS integration | `npx vitest run src/features/chat src/features/flow` | ❌ Wave 0 |
| D-04 | five-state conformance for `FlowsPage`/`RunDetailPage`/`ChatPage` (no blank panel) | TS component | `npx vitest run src/features` | ⚠️ audit-driven (see Wave 0 gaps) |

### Sampling Rate
- **Per task commit:** the relevant quick command (the touched feature's vitest dir, or `go test ./internal/router/`).
- **Per wave merge:** full TS suite `npx vitest run` + `GOWORK=off go test ./...`.
- **Phase gate:** both suites green before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `internal/router/health.go` + `internal/router/health_test.go` — `/api/health` handler + fake-upstream test (up/down/slow-degraded + no-URL-leak assertion). Covers SHELL-02/D-01.
- [ ] `web/src/features/health/useServiceHealth.ts` + `health.test.ts` — poll + mocked `/api/health` + stale-on-error. Covers D-02.
- [ ] `web/src/features/flow/timeline/backoff.ts` + `backoff.test.ts` — pure scheduler with injected `rng`. Covers D-03.
- [ ] Extend `web/src/features/flow/timeline/connection.test.ts` — reconnecting transitions. Covers D-03.
- [ ] Reconnect-resume integration test reusing `web/src/test/mocks/fetch-event-source.ts` (`makeFakeSseStream`). Covers D-03 de-dup invariant.
- [ ] Five-state audit: confirm/fix `FlowsPage.tsx`, `RunDetailPage.tsx`, `ChatPage.tsx` (none import `FiveStateWrapper` — verified). Add component tests where a gap is fixed.
- [ ] Framework install: none needed — Vitest + httptest already present.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | partial | `/api/health` is BFF-owned and sits inside the existing `MiddlewareOperatorAuth` wrap (like `/api/config/env`); upstream health endpoints are auth-none by design (verified). No new auth surface. |
| V3 Session Management | no | No sessions introduced; reconnect inherits each stream's existing auth posture (flow: BFF injects flowd bearer; chat: none). |
| V4 Access Control | yes | `/api/health` is a NEW allowlisted BFF route — it does NOT widen the proxy allowlist (no SSRF surface; the 3 probe URLs are fixed from config, not client-supplied). |
| V5 Input Validation | minimal | `/api/health` takes no input. The SPA renders all health/reconnect strings as TEXT nodes (no `dangerouslySetInnerHTML` — same XSS posture as Phases 2-4). |
| V6 Cryptography | no | No crypto; upstreams auth-none. |
| V9 Communications | yes | Probe URLs come from server-side config only; never from the browser. |
| V7 Error Handling / Logging | yes | `/api/health` must NOT leak internal upstream URLs or raw error strings to the browser — DTO is `status` + `lastChecked` (+ `latencyMs`) only. |

### Known Threat Patterns for {Go BFF health probe + client reconnect}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| `/api/health` echoes upstream URL / error → internal topology disclosure | Information Disclosure | DTO carries only `up\|down\|degraded` + `lastChecked` (+ latency); never the URL or `err.Error()` (Pattern 1 / Pitfall 3). Add a test asserting the response body contains no upstream host. |
| Client-supplied probe target → SSRF | Tampering / Information Disclosure | Probe URLs are FIXED from `cfg.{Memory,Flow,Chat}Base`; `/api/health` accepts no path/query input. Not an open proxy. |
| Reconnect storm hammering upstream after a real failure | Denial of Service (self-inflicted) | Capped backoff (N≈5) + jitter + stop-on-terminal (D-03). The loop clears on terminal/unmount/Stop (Pitfall 4). |
| `/metrics` body parsed/rendered → resource exhaustion or metric-content leak to browser | Information Disclosure / DoS | Status-code-only probe; `io.Copy(io.Discard, body)` (optionally `MaxBytesReader`); the Prometheus body is never forwarded to the SPA. |
| Health string injected into DOM | Tampering (XSS) | All strings rendered as TEXT nodes (inherited Phase 2-4 posture). |

> **No secret leakage:** the flowd bearer (`cfg.FlowdToken`) and operator token are NOT involved in any health probe (all three health endpoints are auth-none) and must never appear in the `/api/health` DTO. The existing `configEnvHandler` deliberately exposes non-secret base URLs for SHELL-04; `/api/health` should NOT additionally expose them per-error.

## Sources

### Primary (HIGH confidence)
- **Sibling repo source (verified by reading route tables + handler bodies):**
  - `llm-agent-flow/cmd/flowd/server/server.go:108,168` + `cmd/flowd/server/auth.go:74` — flowd `GET /healthz` → `200 "ok"`, auth-bypassed.
  - `llm-agent-customer-support/internal/httpapi/httpapi.go:60,204` — chat `GET /healthz` → `200 {"status":"ok"}`.
  - `llm-agent-memory-gateway/cmd/memory-gateway/main.go:254` + `internal/transport/router.go:17` — memory `GET /metrics` only, NO `/healthz`/`/readyz`, no auth on the mux.
- **This repo source (verified):** `internal/router/router.go`, `internal/config/config.go`, `internal/proxy/{flow,memory}.go`, `web/src/features/flow/timeline/{connection.ts,useRunStream.ts,reducer.ts}`, `web/src/features/chat/turns/useChatStream.ts`, `web/src/features/flow/components/ConnectionBadge.tsx`, `web/src/components/shell/{HealthDot,TopBar}.tsx`, `web/src/components/primitives/FiveStateWrapper.tsx`, `web/src/lib/sse.ts`, `web/src/test/mocks/fetch-event-source.ts`.
- **Planning docs:** `05-CONTEXT.md` (D-01..D-04), `05-UI-SPEC.md` (IC-1..IC-5), `REQUIREMENTS.md` (SHELL-02), `ROADMAP.md` (Phase 5), `PROJECT.md` (STACK).

### Secondary (MEDIUM confidence)
- `PROJECT.md` STACK section — package versions (originally npm-registry-verified 2026-06-03).

### Tertiary (LOW confidence)
- Full-jitter backoff formula — training knowledge of the AWS "Exponential Backoff And Jitter" pattern (A1). Well-established but not re-verified this session.

## Metadata

**Confidence breakdown:**
- Verified upstream endpoints: HIGH — read actual route tables + handler bodies in all three sibling repos.
- BFF handler shape: HIGH — modeled on the existing `configEnvHandler`/`/healthz` patterns + Go stdlib.
- Reconnect extension: HIGH — `connection.ts`/`ConnectionBadge.tsx`/`useRunStream`/`useChatStream` all read directly; the fake emitter already supports drop+resume.
- Five-state audit gaps: HIGH — grep confirms `FlowsPage`/`RunDetailPage`/`ChatPage` lack `FiveStateWrapper` imports.
- Backoff numbers/thresholds: MEDIUM — discretion values, tunable.

**Research date:** 2026-06-04
**Valid until:** 2026-07-04 (stable — internal source + Go stdlib + already-pinned deps; no fast-moving external surface).
