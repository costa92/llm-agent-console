---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 6 Plan 1 complete — GAP-1/GAP-2 closed; /api/replay/test added; 06-02 next
last_updated: "2026-06-09T09:26:55.373Z"
last_activity: 2026-06-09
progress:
  total_phases: 6
  completed_phases: 5
  total_plans: 25
  completed_plans: 24
  percent: 83
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-02)

**Core value:** Turn the ecosystem's headless service APIs into one usable, observable operator surface — see and act on what the backends are doing from a single web UI.
**Current focus:** Phase 06 — deploy

## Current Position

Phase: 06 (deploy) — EXECUTING
Plan: 3 of 3 (Plan 01 complete)
Status: Ready to execute
Last activity: 2026-06-09

Progress: [██████████] 96%

## Verification Status (Phase 5)

**Automated gate results (2026-06-09):**

- `GOWORK=off go test ./...` — PASS
- `GOWORK=off go test ./internal/router/ -run Health -count=1` — PASS (3/3 subtests)
- `cd web && npm run test` — PASS (308/308 tests, 38 files)
- `cd web && npm run typecheck` — PASS (0 errors)
- `cd web && npm run lint` — PASS (0 errors, 6 pre-existing warnings)
- `cd web && npm run build` — PASS (726kB, 0 errors)

**Carried forward to Phase 6 (live-service legs, per 05-VALIDATION.md Manual-Only):**

1. Live health dots reflect real service state (requires compose stack up)
2. Live stream transport drop → reconnect → resume with no duplicate events (requires live flowd + nginx drop)

## Performance Metrics

**Velocity:**

- Total plans completed: 1
- Average duration: 6 min
- Total execution time: 0.1 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 1 | 6 min | 6 min |

**Recent Trend:**

- Last 5 plans: 01-01 (6 min)
- Trend: —

*Updated after each plan completion*
| Phase 01 P02 | 18min | 2 tasks | 34 files |
| Phase 01 P03 | 18min | 2 tasks | 11 files |
| Phase 01-foundation P04 | 6min | 2 tasks | 19 files |
| Phase 1 P5 | 3min | 2 tasks | 6 files |
| Phase 02 P01 | 5min | 2 tasks | 6 files |
| Phase 02 P02 | 18min | 2 tasks | 12 files |
| Phase 02 P03 | 10min | 1 tasks | 4 files |
| Phase 02 P04 | 12min | 2 tasks | 8 files |
| Phase 02 P05 | 14min | 2 tasks | 6 files |
| Phase 03 P01 | 16min | 3 tasks | 10 files |
| Phase 03 P03 | 7min | 3 tasks | 6 files |
| Phase 3 P02 | 9min | 3 tasks | 12 files |
| Phase 03 P04 | 7min | 2 tasks | 9 files |
| Phase 03 P05 | 8min | 2 tasks | 9 files |
| Phase 04 P01 | 6 | 3 tasks | 8 files |
| Phase 04 P02 | 4min | 2 tasks | 6 files |
| Phase 4 P3 | 6min | 2 tasks | 6 files |
| Phase 05-health-hardening P05-01 | 9min | 2 tasks | 6 files |
| Phase 06-deploy P06-01 | 3min | 2 tasks | 5 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Stack fixed by research — React 19 + Vite SPA (TanStack Router/Query + shadcn/ui + Tailwind v4, TS pinned 5.9.x) served as static assets behind a thin Go `httputil.ReverseProxy` BFF in this repo.
- [Roadmap]: SSE via `@microsoft/fetch-event-source` (endpoints are SSE-over-POST; native EventSource unusable).
- [Roadmap]: Vertical-slice build order — Memory (REST-only) deliberately before Flow (first SSE) to de-risk auth/cache before the keystone streaming risk.
- [Phase ?]: 01-02: Pinned TypeScript to 5.9.3 (scaffold installed 6.0.2); Tailwind v4 plugin-only (no tailwind.config.js); UI-SPEC dark hex tokens authoritative; sonner fixed dark theme (dropped next-themes)
- [Phase ?]: 01-03: BFF auth boundary — strip all X-*-Id/Authorization then re-materialize gateway scope from X-Console-* (anti confused-deputy); flowd bearer from config, ModifyResponse scrubs Authorization/X-Echo-Auth echo so token never reaches browser (D-01); /api/config/env exposes env+base URLs only.
- [Phase ?]: 01-03: D-01 no-leak is a header-scope guarantee; BFF stays verbatim body pass-through (BFF-04), does NOT content-scan/redact upstream bodies.
- [Phase ?]: 01-04: Shell — makeApiFetcher is the single X-Console-* injection point; OperatorContextBar only calls setContext.
- [Phase ?]: 01-04: Operator context in localStorage holds only {tenant,user,project,session}; auth token never stored (D-01).
- [Phase ?]: 01-04: Shared router.tsx assembles the TanStack routeTree (Shell + memory/flow/chat + / -> /memory) for both main.tsx and tests.
- [Phase ?]: FiveStateWrapper renders Retry/'Set context' buttons but their handlers are optional consumer props — primitive stays reusable across Phases 2-5
- [Phase ?]: RawJsonViewer ships a plain mono <pre> in Phase 1; syntax colorization deferred (no rainbow) per RESEARCH.md
- [Phase ?]: 02-01: Memory client fetchers take Phase-1 apiFetch as arg 1 — X-Console-* identity injection inherited; client never sets X-Tenant-Id/X-User-Id (T-02-01); bodies send scope:{}.
- [Phase ?]: 02-01: Every memory mutation threads expected_version (OCC); write/patch carry a fresh crypto.randomUUID() idempotency_key; body-bearing DELETE sets Content-Type; parseGatewayError surfaces 409 memory_conflict with details.current_version.
- [Phase ?]: 02-01: recall query key = ['recall',{query,top_k,consistency_level}] only — sort/page/state-filter stay client-side (D-03/D-13), never in the key; recall sends only documented fields (DisallowUnknownFields).
- [Phase ?]: 02-02: Memory recall uses a CLIENT-SIDE @tanstack/react-table (sort/page/filter over fetched top-k); top_k is the only server re-query lever (D-03 forced by the gateway flat hits[] contract)
- [Phase ?]: 02-02: D-12 gate is render-first in MemoryPage — the recall-firing subtree is never mounted while tenant/user unset, so no doomed request can fire (MEM-08/IC-7)
- [Phase 02]: 02-03: ItemDrawer open state IS the ?item URL param (D-04/D-05) — reload reopens, browser-back closes, link shareable; close clears ?item without re-running recall (D-09)
- [Phase 02]: 02-03: drawer has NO empty state — a 404 not_found maps to the FiveStateWrapper error state inside the drawer (IC-2: an id implies existence)
- [Phase 02]: 02-03: shadcn sheet (not vaul drawer) added per RESEARCH A1; width overridden to fixed 480px; action-region (Patch/pin/disable/delete) shipped as disabled placeholders for plans 02-04/02-05
- [Phase ?]: 02-05: lifecycle flag toggles REFLECT-FROM-RESPONSE (setQueryData item + setQueriesData recall hit, no GET refetch); delete SPLICES the recall row + drops item cache; neither re-runs recall (D-09 hybrid)
- [Phase ?]: 02-05: two confirm weights in one LifecycleActions — delete=RED shadcn dialog (pattern=dialog+destructive Button), disable=neutral, pin/unpin/enable=no confirm (D-10); pessimistic remove-after-200 (D-11); 409 reuses handle409Conflict
- [Phase ?]: 03-01: flowd client sends NO bearer / NO X-Console-* (T-03-01) — plain fetch not apiFetch; BFF injects the flowd bearer
- [Phase ?]: 03-01: FLAT flowdErrorSchema {error:string} + FlowdError(status,message); parseFlowdError falls back to statusText — NOT Phase-2 parseGatewayError
- [Phase ?]: 03-01: decodeFlowJson (atob+TextDecoder) in one place (A1 decode-on-load); putFlow OMITS id (Pitfall 4); deleteFlow 204=success no body (Pitfall 5)
- [Phase ?]: 03-01: openSseStream onOpen re-applies fetch-event-source content-type open validation AFTER onOpen (no swallow); onRunId fires once per stream (D-08); ssePayloadSchema .loose(), seq only on RunEvent
- [Phase ?]: 03-03: de-dup ordinal = per-SOURCE (kind,node) occurrence index (live & history each from 1), NOT RunEvent seq — makes history+live overlap collide to one event and replay==live
- [Phase ?]: 03-03: connection state is transport-only (any terminal frame→closed); run success/failure is the timeline terminal, not the connection — keeps the typed union minimal and Phase-5 reconnect additive (D-02)
- [Phase ?]: 03-03: retry() branches on a known runId — hydrate GET /events as history (de-dup idempotent) vs re-open runStream when never created; NEVER re-POSTs /run/stream for a created run (D-09/IC-6)
- [Phase ?]: 03-02: flow detail is three full routes (/flows, /flows/new, /flows/flowId), not a search-param drawer (D-05)
- [Phase ?]: 03-02: one route-hosted editor with two modes; edit seeds base64-DECODED flow IR, create seeds {id,nodes,edges}; PUT omits id + sends raw flow; flowd is authoritative validator
- [Phase ?]: 03-04: live render components built here but mounted at the run sub-route in Plan 05; Definition tab hosts only RunTrigger + sync RunResultPanel (D-08)
- [Phase ?]: 03-04: D-09 is color+location — red flow_err in-body (no Retry) vs amber Connection-lost header + Retry->onRetry wired to the hook's retry()=/events-hydrate (never a fresh /run/stream)
- [Phase ?]: 03-04: streamed Run navigates to /flows/{id}/runs/{runId} via a built path string + one documented navigate cast (Plan 05 registers the typed route); run id is a local percent-encoded param only (T-03-12)
- [Phase 04]: 04-01: turnsReducer reads step text from data.answer (not content); done/error terminal, else step; no de-dup/ordinals (chat has no replay)
- [Phase 04]: 04-01: useChatStream marks openedRef on X-Session-Id arrival to split a live drop (->errored) from a non-2xx open (->send-failure); Stop dispatches conn terminal before abort so Stop->closed never errored (D-05/Pitfall 4)
- [Phase 04]: 04-01: session_id reused via request BODY only (never a header); chat client sends Content-Type only (auth-none); connReducer imported cross-feature from features/flow/timeline (not copied)
- [Phase ?]: 04-02: ChatPage owns a page-local 'sending' flag (set on Send, cleared in sendSync().finally) for the sync in-flight composer-disable
- [Phase ?]: 04-02: send-failure → toast.error('Send failed — {status}: {error}.') read off the thrown ChatError + composer re-enables (error-channel split); in-turn agent errors stay in-bubble (04-03)
- [Phase ?]: StepTrace renders only intermediate step rows (all neutral slate); terminal done/error are page treatments (answer / red 'Failed —'), per UI-SPEC Color (a)
- [Phase ?]: D-05 three signals render as three distinct markers keyed off (status, conn): muted Stopped / red Failed / amber Connection lost — the 04-01 machine guarantees Stop->closed
- [Phase ?]: 05-01: /api/health BFF handler with parallel probes (goroutines+WaitGroup); DTO carries only status/lastChecked/latencyMs (T-05-leak)
- [Phase ?]: 05-01: useServiceHealth TanStack Query refetchInterval 15s + stale-on-self-failure (q.isError → unknown + stale lastChecked from q.data)
- [Phase 05]: 05-02: reconnecting state added additively to ConnState; transport-error → reconnecting; reconnect-give-up is the only path to errored; terminal always wins (no storms)
- [Phase 05]: 05-03: chat is manual-retry-only on a drop (handleChatDrop dispatches transport-error+reconnect-give-up atomically from BOTH seams); flow auto-reconnects via capped backoff → retry()/listRunEvents de-dup
- [Phase 05]: 05-04: five-state conformance confirmed (FlowsPage→FiveStateWrapper, RunDetail→FiveStateWrapper, ChatPage inline); reconnect overlay wired on flow timeline (attempt/cap threaded RunDetail→TimelineView→ConnectionBadge) and chat
- [Phase 06]: 06-01: nginx SSE regex ^/api/.*(stream|replay) — structural copy handler pattern for syntheticReplaySSEHandler (not shared helper); TestSyntheticReplaySSEHandler uses httptest.NewServer not recorder for incremental flush proof

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: BFF-03 SSE pass-through is the keystone risk — must be an explicit acceptance gate (curl -N + browser through a real proxy with compression on) before any streaming UI. Phase 1 proves *transport only* (unbuffered flush, no gzip, idle-period survival via raised nginx `proxy_read_timeout`; may use a synthetic stream); auth-on-stream + replay are proven in Phase 3.
- [Phase 3]: Flag for phase-specific research — verify BFF SSE-flush against the actual deploy proxy. Confirmed: flowd/chat emit NO upstream heartbeats and the BFF is a pure pass-through that injects none — idle survival rides on nginx/LB `proxy_read_timeout` covering the longest silent step, with flowd `/replay` + client reconnect for drops. Confirm flowd resume via separate `/replay` (not `Last-Event-ID`).
- [Phase 6]: Verify umbrella fronting proxy/LB (buffering, gzip, idle timeout) against SSE routes; environment-specific.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Live-service UAT | Health dots reflect real service state (flowd/chat/memory-gateway up/down/unknown) | Carried to Phase 6 | Phase 5 verification 2026-06-09 |
| Live-service UAT | Flow stream transport drop → Reconnecting(n/N) → resume with de-dup (requires live flowd + nginx drop) | Carried to Phase 6 | Phase 5 verification 2026-06-09 |

## Session Continuity

Last session: 2026-06-09T09:26:55.366Z
Stopped at: Phase 6 Plan 1 complete — GAP-1/GAP-2 closed; /api/replay/test added; 06-02 next
Resume file: None
