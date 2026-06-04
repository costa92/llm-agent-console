# Roadmap: llm-agent-console

## Overview

Turn three headless ecosystem services (memory-gateway, flowd, customer-support chat) into one observable operator console. The journey runs as vertical slices behind a thin single-origin Go reverse-proxy BFF: first a hardened foundation (BFF auth boundary + SSE pass-through proof + React SPA shell + cross-cutting legibility primitives), then the lowest-risk REST-only Memory console (proves auth injection + query cache), then the keystone SSE-bearing Flow console (live run timeline + replay), then the small Chat console that reuses the streaming infra, then health fan-out + error-state hardening, and finally a compose deploy that preserves unbuffered streaming. Each phase ships a capability an operator can see and act on.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Single-origin BFF (auth boundary + verified SSE pass-through) + SPA shell + cross-cutting primitives (completed 2026-06-03)
- [x] **Phase 2: Memory Console** - REST-only memory recall/detail/lifecycle, proving auth injection + query cache before any SSE (completed 2026-06-03)
- [ ] **Phase 3: Flow Console** - Flow CRUD + first SSE: live run timeline, run history, events/replay (keystone streaming phase)
- [ ] **Phase 4: Chat Console** - Streaming agent-step chat with session continuity, reusing the SSE infra
- [ ] **Phase 5: Health & Hardening** - Always-visible per-service health + five-state/reconnect error hardening
- [ ] **Phase 6: Deploy** - Compose service alongside the umbrella stack with streaming preserved end-to-end

## Phase Details

### Phase 1: Foundation

**Goal**: An operator can reach all three backends through one origin behind a hardened BFF, navigate a working SPA shell with their operator context set, and incremental streaming is proven end-to-end through a real proxy.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: BFF-01, BFF-02, BFF-03, BFF-04, SHELL-01, SHELL-03, SHELL-04, SHELL-05, SHELL-06, SHELL-07
**Success Criteria** (what must be TRUE):

  1. Operator loads the console from a single origin and navigates between Memory, Flow, and Chat console placeholders via a persistent shell/nav.
  2. Operator sets tenant/user (and optional project/session) operator context that persists across reloads and is always displayed, alongside the active environment/endpoint the BFF targets.
  3. The BFF reaches only allowlisted mapped routes, injects gateway/flowd auth server-side, strips inbound client-set scope headers, and the flowd bearer token never appears in the browser bundle, network responses, or logs (grep-gated).
  4. A `POST` SSE stream proxied through the BFF renders incrementally (per-event flush, no gzip on `text/event-stream`, idle-period survival via a raised nginx `proxy_read_timeout` — the BFF injects NO heartbeat, and flowd/chat emit none) — verified with `curl -N` and in-browser through a real fronting proxy with compression on. **Gate split:** Phase 1 proves only the *transport* (unbuffered flush, no gzip, idle-period survival through the real fronting proxy) and may use a synthetic test-stream endpoint; *auth injection on the stream hop, upstream-heartbeat-absence, and replay semantics* are proven in Phase 3 against real flowd.
  5. The BFF passes through upstream status codes and error bodies, and every view exposes loading/empty/error states, toast feedback, a copyable raw-JSON viewer, and one-click id copy.

**Plans**: 5 plans

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — BFF skeleton + synthetic SSE proof endpoint + nginx config (BFF-03 keystone gate)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — SPA scaffold (Vite + React 19 + TypeScript 5.9.3 + Tailwind v4 + shadcn + Vitest)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Auth boundary: three upstream directors + operator token middleware + /api/config/env
- [x] 01-04-PLAN.md — Shell layout: NavBar + TopBar + OperatorContextBar + HealthDot + placeholder routes

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-05-PLAN.md — Cross-cutting primitives: FiveStateWrapper + RawJsonViewer + CopyableId

**UI hint**: yes

### Phase 2: Memory Console

**Goal**: An operator can search, inspect, and run the full memory lifecycle against the gateway with operator-context auth injected server-side and confirm-then-reflect safety on destructive actions.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: MEM-01, MEM-02, MEM-03, MEM-04, MEM-05, MEM-06, MEM-07, MEM-08
**Success Criteria** (what must be TRUE):

  1. Operator runs a recall/search and sees ranked results with score and metadata, each linking to a memory item detail with rendered fields plus raw JSON.
  2. Operator writes a new memory record and patches an existing one via a validated JSON editor, with success/failure surfaced in toasts carrying the upstream message.
  3. Operator pins/unpins and disables/enables a memory item, with state reflected only after the backend confirms (pessimistic UI).
  4. Operator deletes a memory item through an explicit confirmation step, with delete/disable gated behind confirmation.
  5. When tenant/user context is unset, the console clearly indicates memory is unavailable and gates all memory actions behind operator context.

**Plans**: 5 plans (vertical slices: Wave 0 foundation → Slice A recall → Slice B drawer → Slice C lifecycle)

Plans:
**Wave 1** *(foundation — typed client + zod schemas + test mocks; blocked on Phase 1 execution)*

- [x] 02-01-PLAN.md — Typed /api/memory client + zod schemas (verified gateway contract) + test mock harness

**Wave 2** *(Slice A — blocked on 02-01)*

- [x] 02-02-PLAN.md — Recall→render: Memory route + D-12 context gate + SearchControls + client-side ResultsTable with pinned/disabled badges

**Wave 3** *(Slice B — blocked on 02-02)*

- [x] 02-03-PLAN.md — Item detail drawer: ?item-synced sheet, GET item, rendered fields + raw JSON viewer

**Wave 4** *(Slice C-1 — blocked on 02-03)*

- [x] 02-04-PLAN.md — Write/patch JSON editor (one editor, two modes) + write/patch mutations (refetch-after, D-09) + first-class 409 OCC recovery

**Wave 5** *(Slice C-2 — blocked on 02-04)*

- [x] 02-05-PLAN.md — Lifecycle: pin/unpin/disable/enable/delete with two confirm weights, pessimistic UI, reflect-from-response + delete splice, 409 reuse

**UI hint**: yes

### Phase 3: Flow Console

**Goal**: An operator can manage flows as JSON, trigger synchronous and streamed runs, watch a live append-only event timeline, and browse/replay past runs in that same renderer — proving SSE-through-BFF end-to-end.
**Mode:** mvp
**Depends on**: Phase 2 (auth/cache/shell proven); requires the Phase 1 SSE pass-through gate (BFF-03)
**Requirements**: FLOW-01, FLOW-02, FLOW-03, FLOW-04, FLOW-05, FLOW-06
**Success Criteria** (what must be TRUE):

  1. Operator sees a list of flows and opens a flow detail; can create, edit (JSON validated + round-tripped on PUT), and delete (with confirmation) a flow.
  2. Operator triggers a synchronous run and sees its outputs/result.
  3. Operator triggers a streamed run and watches a live append-only event timeline (node started/finished, terminal done/error) with per-node status, auto-scroll that pauses on manual scroll, and a visible connection state (streaming/closed/errored).
  4. Operator browses run history for a flow and opens a run detail with status and timestamps.
  5. Operator browses a completed run's events and replays them in the same timeline renderer used for live runs, with late-join events hydrated from `/events` then de-duped against the live stream.

**Plans**: 5 plans (vertical slices: Wave 0 foundation → Slice A CRUD → Slice B keystone units + UI → Slice C history+replay)

Plans:
**Wave 1** *(foundation — typed /api/flow client + zod schemas + flat-error parser + REST/SSE test mocks; blocked on Phase 2)*

- [x] 03-01-PLAN.md — Typed /api/flow client + zod schemas (verified flowd contract, base64 round-trip, flat {error}) + REST fetch-mock + controllable fake SSE emitter (FLOW-01..06)

**Wave 2** *(Slice A CRUD + Slice B keystone units — parallel, no file overlap; blocked on 03-01)*

- [ ] 03-02-PLAN.md — Flow CRUD: /flows list + /flows/{id} tabs + route-hosted JSON editor (base64 round-trip, create/edit) + red delete-confirm (FLOW-01, FLOW-02)
- [x] 03-03-PLAN.md — Keystone units (TDD): pure timelineReducer + (kind,node,ordinal) de-dup + connection-state machine + imperative useRunStream hook (FLOW-03, FLOW-04, FLOW-05, FLOW-06)

**Wave 3** *(Slice B UI — blocked on 03-02 + 03-03)*

- [ ] 03-04-PLAN.md — Live timeline UI: TimelineView + NodeStatusList + ConnectionBadge + RunTrigger (streamed + sync, one result surface) + auto-scroll-pause + D-09 distinction (FLOW-03, FLOW-04)

**Wave 4** *(Slice C — blocked on 03-04)*

- [ ] 03-05-PLAN.md — Run history table + deep-linkable run sub-route + instant-fill replay through the SAME reducer/renderer + empty-events state (FLOW-05, FLOW-06)

**UI hint**: yes
**Research**: Flag for phase-specific research (`/gsd:plan-phase --research-phase`) — highest-risk phase: verify BFF SSE-flush hardening against the actual deploy proxy. Confirmed (no longer open): flowd/chat emit NO upstream heartbeats and the BFF is a pure pass-through that injects none — so the open item is verifying the nginx/LB `proxy_read_timeout` covers the longest silent step, with flowd `/replay` + client reconnect covering drops. Also confirm flowd honors resume via the separate `/replay` endpoint (not `Last-Event-ID`).

### Phase 4: Chat Console

**Goal**: An operator can drive a customer-support chat session, watch streamed agent steps render incrementally with session continuity, and fall back to a synchronous one-shot — reusing the Phase 3 SSE infra.
**Mode:** mvp
**Depends on**: Phase 3 (SSE client, pass-through, and timeline renderer)
**Requirements**: CHAT-01, CHAT-02, CHAT-03
**Success Criteria** (what must be TRUE):

  1. Operator sends a message and watches streamed agent steps render incrementally with a streaming indicator and stop-on-error.
  2. Chat maintains session continuity, reusing the session id across turns.
  3. Operator can use the synchronous `/chat` fallback for a one-shot message, reusing the same message rendering.

**Plans**: TBD
**UI hint**: yes

### Phase 5: Health & Hardening

**Goal**: An operator always sees per-service health at a glance, and every streaming/error/disconnected surface across the console is hardened into explicit, recoverable states.
**Mode:** mvp
**Depends on**: Phase 4 (all three upstreams wired; happy paths proven)
**Requirements**: SHELL-02
**Success Criteria** (what must be TRUE):

  1. Operator sees always-visible per-service health (up/down/degraded) for memory-gateway, flowd, and chat, polled on an interval with a last-checked timestamp.
  2. Each area enforces the UI-SPEC five-state contract (loading/empty/error/partial/ready), with stream views adding the SSE-specific disconnected/reconnecting state on top — no ambiguous blank screens.
  3. Stream views show connection status with manual retry, and the client applies reconnect backoff with a cap and closes on the terminal `done` event (no reconnect storms).

**Plans**: TBD
**UI hint**: yes

### Phase 6: Deploy

**Goal**: The console runs alongside the umbrella stack as a **proxy-only Go BFF** plus a **fronting static host (nginx)** that serves the built SPA and reverse-proxies `/api/*` to the BFF on one origin — with that fronting proxy configured NOT to buffer the stream routes. (Per Phase-1 CONTEXT D-04/D-05/D-06 — not a `go:embed` single binary.)
**Mode:** mvp
**Depends on**: Phase 5
**Success Criteria** (what must be TRUE):

  1. The console deploys as long-lived compose service(s) — a proxy-only Go BFF + a fronting static host (nginx) serving the SPA at `/` and proxying `/api/*` to the BFF on a single origin (no embedded SPA, no CORS) — reachable in the umbrella stack, not serverless/edge.
  2. Streamed flow runs and chat render incrementally through the deployed stack, with the fronting nginx verified not to buffer, gzip, or idle-timeout the stream routes (`proxy_buffering off`, no gzip on `text/event-stream`, `X-Accel-Buffering: no` passthrough).
  3. Required LB/proxy idle-timeout and buffering settings are documented for the deploy environment.

**Plans**: TBD
**Research**: Flag for phase-specific research — verify the umbrella's fronting proxy/LB config (buffering, gzip, idle timeout) against SSE routes; environment-specific, not in current research.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 5/5 | Complete   | 2026-06-03 |
| 2. Memory Console | 5/5 | Complete   | 2026-06-03 |
| 3. Flow Console | 2/5 | In Progress|  |
| 4. Chat Console | 0/TBD | Not started | - |
| 5. Health & Hardening | 0/TBD | Not started | - |
| 6. Deploy | 0/TBD | Not started | - |
