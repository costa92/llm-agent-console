# Phase 3: Flow Console - Research

**Researched:** 2026-06-03
**Domain:** React 19 SPA feature slice (flow CRUD + sync/streamed runs + live event timeline + run history + replay) over the FIXED flowd HTTP+SSE contract, through the single-origin Go BFF. First SSE-bearing phase — the keystone streaming risk.
**Confidence:** HIGH — the entire flowd contract (routes, DTOs, SSE frame schema, replay/auth semantics) was read directly from source (`../llm-agent-flow/cmd/flowd/server/server.go`, `flow/store/store.go`, `cmd/flowd/server/auth.go`) plus the executed Phase-1 BFF flow director (`internal/proxy/flow.go`) and the Phase-1 `sse.ts` stub. The keystone-risk and replay-dedup findings are grounded in actual `writeSSE`/`writeSSERaw` code, not training data.

## Summary

This phase is gated by **two fixed contracts read from source**: (1) flowd's REST + SSE wire shape, and (2) the *already-executed* Phase-1 BFF flow director + SSE pass-through. The headline findings:

1. **The SSE frame schema is `event: <kind>\ndata: <json>\n\n` with SIX event kinds** (`flow_started`, `node_started`, `node_finished`, `node_skipped`, `flow_done`, `flow_err`) — verified from `eventKindString` + `writeSSE`. The `data` payload is `streamPayload(ev)`: an object with optional `flow`, `node`, `input`, `output`, `outputs`, `error`, `metadata` keys. **ONE renderer serves both live and replay** because replay (`writeSSERaw`) forwards the *byte-for-byte persisted payload* under the same `event: <kind>` line — identical frame shape. This satisfies success criterion 5 by construction.

2. **THE KEYSTONE RISK is confirmed and bounded.** flowd emits **NO** `:` heartbeat comment, **NO** `id:` line, **NO** `retry:` line — pure `event:`/`data:` frames (verified: `writeSSE`/`writeSSERaw` `Fprintf` only `event:`/`data:`). The Phase-1 BFF is a pure `httputil.ReverseProxy` that injects none. **Therefore idle-survival rides entirely on the fronting nginx `proxy_read_timeout` (set to 3600s in Phase 1 `deploy/nginx.conf`) covering the longest silent step** — a slow LLM/tool node that emits no event for minutes. There is no application-level keepalive anywhere in the chain. The console MUST treat a mid-stream connection drop as a real, expected state and recover via the separate `/replay` endpoint + `GET /events` rehydration, NOT via `Last-Event-ID` (which flowd does not honor).

3. **The de-dup key is NOT in the SSE frame** — the most important subtlety for the planner. The persisted `RunEvent` has a monotonic 1-indexed `seq`, but **`seq` is only present in the `GET /runs/{id}/events` JSON response, never in the SSE `data:` payload** (`streamPayload` does not emit it; `writeSSERaw` forwards only the stored payload, not the seq column). So live-stream events and replay/`/events`-hydrated events carry **no shared server-supplied identity**. De-dup must key on **(kind, node, arrival-ordinal)** within a run, treating the event stream as an ordered append-only log where the Nth `node_started` for node X is the same logical event whether it arrived live or via history. See "Replay/late-join de-dup" below for the concrete strategy.

4. **Auth on the stream hop is already solved by Phase 1 and the console must do NOTHING.** The executed `internal/proxy/flow.go` director strips inbound `Authorization`, injects `Bearer <FLOWD_TOKEN>` server-side, strips `X-Console-*`, and `ModifyResponse` scrubs any echoed auth + applies `sseBufferingDefense` (sets `X-Accel-Buffering: no` + `Cache-Control: no-cache, no-transform` on `text/event-stream`). `/healthz` is open (flowd `authBypass`). **The console sends NO bearer, NO `X-Console-*` for flowd calls** — flowd is not scope-aware; it only checks the optional bearer the BFF injects.

**Primary recommendation:** Build three vertical slices over a thin typed `/api/flow/*` client + an imperative SSE timeline reducer. **Slice A** — flow CRUD REST (list/create/edit-PUT-roundtrip/delete-confirm) via TanStack Query, reusing every Phase-2 pattern (query-key factory, zod editor, confirm dialog). **Slice B (the keystone)** — first streamed run: imperative `openSseStream` → timeline reducer → live append-only render with connection-state machine + per-node status + auto-scroll-pause; plus the sync run path. **Slice C** — run history list + run detail + replay through the *same* reducer/renderer, with `GET /events` late-join hydration de-duped against any live tail. Treat the timeline reducer as a pure function (event log → render model) so it is unit-testable without a live flowd, and so live + replay feed the identical code path.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Flow CRUD (list/get/create/PUT/delete) | API (flowd) | Browser (TanStack Query cache) | flowd owns persistence + compile-validation; SPA renders + caches |
| Flow JSON well-formedness + compile validation | API (flowd `compileProbe`) | Browser (zod well-formedness only) | flowd is the authoritative validator (returns 400 on compile error); client zod is fast pre-submit feedback for JSON well-formedness only — it CANNOT validate flow semantics |
| Sync run (`/run`) | API (flowd) | Browser (render outputs) | flowd executes; SPA renders the `{outputs, run_id}` response |
| Streamed run (`/run/stream`) | API (flowd) → BFF (pass-through) | Browser (imperative SSE consume) | flowd emits frames; BFF flushes unbuffered; SPA drives the stream imperatively (NOT via Query cache) |
| SSE transport (flush/no-gzip/idle survival) | BFF + fronting nginx | — | Phase-1 proven; flowd sets `X-Accel-Buffering: no`, BFF passes through, nginx `proxy_read_timeout 3600s` |
| Stream-hop auth injection | BFF (flow director) | — | Already executed (Phase-1 `internal/proxy/flow.go`); console sends no bearer |
| Live timeline render model (event log → UI) | Browser (pure reducer) | — | Client-only aggregation; per-node status + ordering derived from the append-only event sequence |
| Connection-state machine (streaming/closed/errored) | Browser | — | Client tracks open/terminal/abort; Phase-5 adds reconnecting on top — design to extend |
| Auto-scroll-pauses-on-manual-scroll | Browser | — | Pure DOM/scroll concern in the timeline component |
| Run history list + run detail | API (flowd) | Browser (TanStack Query) | flowd owns run rows; SPA caches/renders |
| Replay + late-join hydration | API (flowd `/replay` + `/events`) | Browser (de-dup vs live) | flowd re-streams persisted events; SPA de-dupes against any live tail into one timeline |

## Standard Stack

This phase introduces **ONE consideration** beyond the LOCKED Phase-1 stack: confirming `@microsoft/fetch-event-source` (already installed, used by the Phase-1 `sse.ts` stub) is correctly driven. **No new npm packages.** Everything below is already a project dependency.

### Core (already installed — reused, not added)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react / react-dom | 19.2.x | UI | Locked stack [CITED: PROJECT.md] |
| @microsoft/fetch-event-source | 2.0.1 | SSE-over-POST client; the `openSseStream` wrapper in `web/src/lib/sse.ts` already wraps `fetchEventSource` | **Required** — both stream endpoints are POST; native `EventSource` is GET-only [CITED: PROJECT.md; VERIFIED: web/src/lib/sse.ts exists with `fetchEventSource`] |
| @tanstack/react-query | 5.101.x | REST CRUD cache (flows list/detail, runs list, run detail) + invalidation after a run | Standard for REST admin CRUD; **SSE bypasses it** (driven imperatively) [CITED: PROJECT.md] |
| @tanstack/react-router | 1.170.x | URL state: selected flow, `?run=` detail, `?tab=` history/edit | Type-safe search params [CITED: PROJECT.md] |
| @tanstack/react-table | 8.21.x | Flows list + runs-history table (client sort/page over fetched rows) | Headless table [CITED: PROJECT.md] |
| react-hook-form + zod | 7.77.x / 4.4.x | Flow create/edit JSON editor + well-formedness validation | Pairs with zod resolver [CITED: PROJECT.md] |
| shadcn/ui | CLI 3.x | dialog (delete confirm), sheet/drawer (flow detail, run detail), badge (run status, per-node status), tabs (detail/history/edit) | Owned components, Phase-1 design system [CITED: 01-UI-SPEC.md] |
| sonner | 2.0.x | Run-trigger / CRUD toast feedback (SHELL-06) | App-wide toast, built Phase 1 [CITED: 01-UI-SPEC.md] |

### Supporting (verify availability — copy-in blocks)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| shadcn `tabs` | shadcn registry | Flow detail: Definition / Runs / Edit tabs; Run detail: Summary / Timeline | The flow-detail and run-detail surfaces [ASSUMED — planner confirms block name at `shadcn add` time; official registry, no vetting gate per 01-UI-SPEC] |
| shadcn `sheet` | shadcn registry | Run detail drawer (mirror Phase-2 `?item` pattern with `?run`) | Run detail over the history list |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@microsoft/fetch-event-source` | Hand-rolled `fetch()` + `ReadableStream` SSE parser | The wrapper already exists (`sse.ts`), is battle-tested, and handles POST + headers + abort. Hand-rolling re-implements frame parsing for zero gain. [VERIFIED: PROJECT.md "What NOT to Use"] |
| Imperative SSE → local reducer state | Drive SSE through TanStack Query cache | **Wrong tool** — streams are append-only event sequences, not cache entries; Query has no streaming model. Locked decision: streams bypass Query (PROJECT.md SSE section). |
| One reducer for live + replay | Two separate renderers | Success criterion 5 *requires* the same renderer; replay frames are byte-identical to live frames (verified). Two renderers would diverge. |

**Installation:** None. No `npm install`. shadcn blocks (`tabs`, `sheet`, `badge`, `dialog`) are copy-in from the official registry (not npm runtime deps); most were already added in Phase 1/2.

## Package Legitimacy Audit

**Not applicable — this phase installs no external packages.** All runtime dependencies were vetted and locked in Phase-1 research (PROJECT.md ## Sources cite `npm view` verification 2026-06-03, including `@microsoft/fetch-event-source 2.0.1`, npm `modified` 2026-04-23 — the actively-maintained upstream). The SSE client is already installed and used by the Phase-1 `sse.ts` stub. shadcn blocks are official-registry copy-in code (no npm package, no vetting gate per 01-UI-SPEC ## Registry Safety). No new entries enter `package.json`.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FLOW-01 | List flows (`GET /flows`); row opens detail | `handleListFlows` returns `{"flows": [FlowMeta...]}`; `FlowMeta = {id, name?, created_at, updated_at}` (store.go). Client-side table over the returned list. |
| FLOW-02 | View/edit flow JSON (`GET/PUT /flows/{id}`), create (`POST /flows`), delete (`DELETE`, confirm); validate well-formedness + round-trip on PUT | `handleGetFlow`→`FlowRecord{...FlowMeta, json}`; `handlePutFlow`/`handleCreateFlow` take `{id, name?, flow:<rawJSON>}`; both run `compileProbe` (400 on compile error); DELETE→204. **Round-trip:** GET returns `json` bytes → edit → PUT the same envelope. See "Flow CRUD contract" + PUT id-match pitfall. |
| FLOW-03 | Trigger sync run (`POST /flows/{id}/run`), see outputs | `handleRun`→`runWithStore(stream=false)`→`{outputs:map, run_id}` (200) or upstream error (4xx/5xx) with `{"error":"..."}`. `X-Run-ID` header always set. |
| FLOW-04 | Trigger streamed run (`POST /flows/{id}/run/stream`); live append-only timeline (node started/finished, terminal done/error) + per-node status + auto-scroll-pause + visible connection state | `handleRunStream`→`runWithStore(stream=true)` emits the 6-kind SSE frame schema below. `X-Run-ID` set before first frame. See "SSE frame schema" + "Timeline reducer" + "Connection-state machine". |
| FLOW-05 | Browse run history (`GET /flows/{id}/runs`), open run detail (`GET /runs/{id}`) with status + timestamps | `handleListRunsForFlow`→`{"runs":[RunMeta...]}`; `RunMeta={id, flow_id, status, started_at, finished_at?}`; `handleGetRun`→`RunRecord{...RunMeta, inputs?, outputs?, error?}`. Status ∈ {running, done, failed}. |
| FLOW-06 | Browse a completed run's events (`GET /runs/{id}/events`) + replay (`POST /runs/{id}/replay`) in the SAME timeline renderer; late-join hydrated from `/events` then de-duped against live | `handleListRunEvents`→`{"events":[RunEvent...]}` with `seq`; `handleReplayRun`→SSE re-stream of persisted payloads (byte-for-byte, same `event:` lines). **De-dup key is NOT in the frame — see "Replay/late-join de-dup".** |
</phase_requirements>

---

## THE FLOWD CONTRACT (verified from source — the central research target)

> Source files (all read this session; flowd must NOT be modified):
> `../llm-agent-flow/cmd/flowd/server/server.go` (routes + handlers + `writeSSE`/`writeSSERaw`/`streamPayload`/`eventKindString`),
> `../llm-agent-flow/flow/store/store.go` (`FlowMeta`/`FlowRecord`/`RunMeta`/`RunRecord`/`RunEvent`/`RunEventKind`),
> `../llm-agent-flow/cmd/flowd/server/auth.go` (`BearerTokenAuthenticator`, `authBypass`, `withAuth`),
> `../llm-agent-flow/cmd/flowd/server/server_events_test.go` (event-sequence golden expectations).

### Routes (exact, from `(*Server).Handler()` — the v0.0.5 store-backed surface) [VERIFIED: flowd server.go]
```
GET    /healthz                       → "ok" text/plain; AUTH-BYPASSED (open)
POST   /flows                         → create; 201 FlowRecord | 409 if id exists
GET    /flows                         → {"flows":[FlowMeta]}
GET    /flows/{id}                    → FlowRecord | 404
PUT    /flows/{id}                    → 200 FlowRecord (replace-or-insert)
DELETE /flows/{id}                    → 204 No Content | 404
POST   /flows/{id}/run                → 200 {outputs, run_id} | 4xx/5xx {error}   (sync)
POST   /flows/{id}/run/stream         → 200 text/event-stream (SSE)               (stream)
GET    /flows/{id}/runs               → {"runs":[RunMeta]}
GET    /runs/{id}                     → RunRecord | 404
GET    /runs/{id}/events              → {"events":[RunEvent]}  (200 even for unknown run → empty)
POST   /runs/{id}/replay              → 200 text/event-stream (SSE re-stream)      | 404 if run unknown
```
The path param is `{id}`. **The BFF maps the console's `/api/flow/*` prefix to flowd's root** via `http.StripPrefix("/api/flow", NewFlowProxy(cfg))` [VERIFIED: console `internal/router/router.go:36`]. So the console calls e.g. `POST /api/flow/flows/echo_chain/run/stream` → flowd `POST /flows/echo_chain/run/stream`. **This is the verified, executed prefix — not assumed** (unlike Phase-2's open question, Phase 1 is now built).

> ⚠️ **Legacy vs store-backed:** flowd also has `NewMux` (legacy single-engine: only `/healthz`, `/run`, `/run/stream`) and conditional `/run` + `/run/stream` aliases when `Config.LegacyFlowID` is set. **The console targets the v0.0.5 `New(cfg).Handler()` surface** (the full CRUD shape above). The deploy must wire flowd via `New(cfg)`, not `NewMux`. Planner: confirm the umbrella runs flowd with the store-backed server (it must, for CRUD/history/replay to exist).

### Request/Content-Type rules [VERIFIED: flowd server.go]
- All bodies are decoded with `json.NewDecoder(...).DisallowUnknownFields()` (`decodeJSON`). **Sending undocumented fields → 400** (`decode body: ...`). Send only documented fields.
- flowd does **NOT** enforce `Content-Type: application/json` (no `EnsureJSONRequest` middleware like the gateway). But the console should set it anyway (the SSE client wrapper already defaults it; harmless).
- Run requests take `{"inputs": {"<name>":"<string>"}}` — `runRequest{Inputs map[string]string}`. **Inputs are string→string only** (not arbitrary JSON values).

### Flow CRUD contract [VERIFIED: flowd server.go + store.go]

**Create — `POST /flows`** body `createFlowRequest`:
```jsonc
{ "id": "echo_chain",          // optional if the flow body has a top-level "id"
  "name": "Echo Chain",         // optional; falls back to body "name"
  "flow": { /* raw flow IR JSON */ } }   // REQUIRED (json.RawMessage)
```
- `flowHeaderFromBody` reconciles id/name: URL/outer id wins; if body `flow.id` disagrees with the chosen id → **400** `body's flow.id %q does not match outer id %q`.
- `compileProbe` parses+compiles the flow → **400** `flow compile: ...` on any IR/compile error. **This is flowd validating flow semantics — the client cannot replicate it.** Surface the 400 message in a toast.
- Success → **201** with `FlowRecord` (the stored row).
- Duplicate id → **409** `flow %q already exists`.

**Read — `GET /flows/{id}`** → `FlowRecord`:
```jsonc
{ "id":"echo_chain", "name":"Echo Chain",
  "created_at":"2026-06-03T...Z", "updated_at":"2026-06-03T...Z",
  "json": <flow IR bytes> }   // FlowRecord embeds FlowMeta + JSON []byte
```
> **`json` is `[]byte` in Go** → it serializes as a **base64 string** in the HTTP response (Go's default `[]byte` JSON encoding), NOT as an inline object. **The editor must base64-decode `json` to get the flow text, and the PUT body must send the flow as raw JSON under `flow` (json.RawMessage), not base64.** [VERIFIED: `FlowRecord.JSON []byte` in store.go; Go encodes `[]byte` as base64]. **This is a load-bearing round-trip detail — flag for the planner.** (If a custom MarshalJSON exists it would change this; none was found in store.go, so default base64 applies. Planner: verify empirically against a live `GET /flows/{id}` before finalizing the editor decode path — see Open Questions Q1.)

**Update — `PUT /flows/{id}`** body (same `createFlowRequest`):
- URL id is source of truth; if body `id` is non-empty and ≠ URL id → **400** `body id %q does not match URL id %q`. **→ The editor should omit `id` from the PUT body, or set it equal to the URL id.**
- `flow` field required (400 if empty); `compileProbe` runs (400 on compile error); evicts the engine cache.
- Success → **200** `FlowRecord`.

**Delete — `DELETE /flows/{id}`** → **204 No Content** (empty body) | **404**. No body required. **→ The delete handler must treat 204 (not 200) as success and parse no JSON.**

### Sync run — `POST /flows/{id}/run` [VERIFIED: flowd server.go]
Body `{"inputs":{...}}` → on success **200** `{"outputs":{<name>:<string>}, "run_id":"..."}` (`runResponse`). `X-Run-ID` response header always set. On a config-level/run error → status from `statusForError` (400 for validation/missing-input, 500 otherwise) with `{"error":"..."}`. **Even a failed sync run persists events** (the run still appears in history with status `failed`). The console renders `outputs` on success, the `error` string on failure.

### THE SSE FRAME SCHEMA (the renderer contract — success criterion 5) [VERIFIED: flowd writeSSE + streamPayload + eventKindString]

Both `/run/stream` (live) and `/replay` emit frames via `fmt.Fprintf(w, "event: %s\ndata: %s\n\n", kind, json)`. **Frame shape:**
```
event: <kind>
data: <compact-json-payload>
<blank line>
```
- **NO `id:` line. NO `retry:` line. NO `:` heartbeat comment.** Pure `event:`/`data:`. [VERIFIED — `writeSSE`/`writeSSERaw` Fprintf only these two lines.]
- `@microsoft/fetch-event-source` parses `event` → `ev.event`, `data` → `ev.data`. The Phase-1 `openSseStream` already exposes both: `onMessage({ data, event })`. **The console keys its reducer on `ev.event` (the kind) + `JSON.parse(ev.data)` (the payload).**

**The 6 event kinds** (`eventKindString`) — `RunEventKind` constants:
| `event:` kind | Emitted when | Terminal? |
|---------------|--------------|-----------|
| `flow_started` | run begins | no |
| `node_started` | a node begins | no |
| `node_finished` | a node completes | no |
| `node_skipped` | a node is skipped (unmet edge condition) | no |
| `flow_done` | run succeeded | **YES** (close stream) |
| `flow_err` | run failed (config or node error) | **YES** (close stream) |

**The `data:` payload** is `streamPayload(ev)` — an object with **only the populated keys** (each omitted when empty):
```jsonc
{ "flow":     "echo_chain",            // ev.FlowID — present on flow-level events
  "node":     "upper",                 // ev.NodeID — present on node-level events
  "input":    { /* node input */ },    // present if non-nil
  "output":   { /* node output */ },   // present if non-nil (on node_finished)
  "outputs":  { "out":"OLLEH" },       // present on flow_done (final outputs)
  "error":    "missing required input...", // present on flow_err / node error
  "metadata": { /* otel-style attrs */ } } // present only if populated
```
**Field-presence rules (load-bearing for the reducer):**
- A `node_started`/`node_finished`/`node_skipped` frame carries `node` (the node id) — the per-node-status aggregation keys on this.
- `flow_done` carries `outputs` (the final result) and `flow`.
- `flow_err` carries `error` (the failure message) — render this as the terminal error.
- `flow_started` carries `flow` (and possibly `input`).
- **There is NO `seq`, NO timestamp, NO event-id in the SSE payload.** (Confirmed: `streamPayload` emits none of these; `seq`/`ts` exist only on the persisted `RunEvent` returned by `GET /events`.) This is THE de-dup constraint — see below.

### Run history + detail [VERIFIED: flowd store.go + server.go]

**`GET /flows/{id}/runs`** → `{"runs":[RunMeta]}`, `RunMeta`:
```jsonc
{ "id":"run_abc", "flow_id":"echo_chain",
  "status":"done",                 // "running" | "done" | "failed"
  "started_at":"2026-06-03T...Z",
  "finished_at":"2026-06-03T...Z" } // omitted while running (nil = in-flight)
```
**`GET /runs/{id}`** → `RunRecord` (= `RunMeta` + `inputs?`, `outputs?`, `error?`). 404 on unknown run.

**`GET /runs/{id}/events`** → `{"events":[RunEvent]}`, `RunEvent` (**this is where `seq` lives**):
```jsonc
{ "seq": 3,                        // 1-indexed, monotonic WITHIN a run; the stable ordering key
  "kind": "node_finished",         // same string values as the SSE event: kinds
  "node_id": "upper",              // omitted if empty
  "payload": { /* same streamPayload shape */ },  // json.RawMessage
  "ts": "2026-06-03T...Z" }
```
> **Unknown run → `GET /events` returns `200 {"events":[]}` (NOT 404)** — idempotent for replay clients (verified: `TestRunEventsHTTPMissingRunReturnsEmpty`). The console must treat empty-events as a valid empty state, not an error. (Note `handleListRunEvents` *also* has a `ErrNotFound`→404 branch, but the SQLite store returns an empty slice rather than `ErrNotFound` for unknown runs — so in practice 200+empty. Plan for both; treat 404 as "no such run" and 200+empty as "run exists, no events yet".)

**Event ordering for the renderer:** `GET /events` returns events **in `seq` order, oldest first** (store.go `ListRunEvents` contract). The persisted sequence for a successful linear flow is `flow_started → (node_started, node_finished)* → flow_done` (verified golden: `expectedKindsForEchoChain`). A failed run ends in `flow_err` (verified: `TestRunEventsForFailedRunIncludesFlowErr`). `node_skipped` appears for unmet-condition branches (verified: `TestRunEventsRouterIncludesNodeSkipped`).

### Replay — `POST /runs/{id}/replay` (NOT `Last-Event-ID`) [VERIFIED: flowd handleReplayRun]
- Re-streams the run's **persisted events** as a fresh SSE session — **no new engine run**. `ListRunEvents(runID, 0)` → for each, `writeSSERaw(w, string(ev.Kind), ev.Payload)` + flush. **Byte-for-byte the same `event: <kind>\ndata: <payload>` frames the live stream produced.** → the SAME client reducer/renderer consumes both (success criterion 5 holds by construction).
- Unknown run → **404** `run %q not found`. Empty event log → **200** with zero SSE frames (idempotent).
- Sets `X-Run-ID` + `X-Replay: true` response headers. (The console can read `X-Replay` to label the timeline as a replay, but it's cosmetic.)
- **Resume semantics = `/replay` (full re-stream), NOT `Last-Event-ID`.** flowd reads no `Last-Event-ID` header anywhere. A v2 partial-resume would need `GET /events` + client-side seq filtering; v1 does a full re-stream or a `/events` JSON hydrate. **[VERIFIED: no `Last-Event-ID` reference in flowd server.go — confirms the ROADMAP/STATE assumption.]**

### Replay / late-join de-dup — THE stable identity problem [VERIFIED: streamPayload omits seq; writeSSERaw forwards payload only]

**The constraint:** SSE frames (live AND replay) carry **no `seq`, no id, no timestamp**. Only the `GET /events` JSON carries `seq`. So when the console hydrates late-join history from `GET /events` and then de-dupes against a live stream tail, **there is no server-supplied key shared between the two sources.**

**The de-dup strategy (recommend to planner):** model the timeline as an **ordered append-only event log per run**, where logical identity = **(kind, node, ordinal-within-(kind,node))**. Concretely:
1. Maintain `events: TimelineEvent[]` in reducer state, append-only, in arrival order.
2. For **live streaming**, every frame appends (the live stream is authoritative ordering).
3. For **late-join hydration** (`GET /events` returns history while/before a live tail arrives), reconcile by **position**: the hydrated history is the prefix; the live stream continues from where history ends. Because flowd persists each event *before* forwarding it on the stream path (`AppendRunEvent` then `writeSSE` — verified in `runWithStore`), **the `/events` history is always a prefix (or equal) of what the live stream has emitted** — never ahead, never reordered. So de-dup = "drop any live frame whose (kind, node, ordinal) already exists in the hydrated prefix."
4. **Practical v1 simplification:** because replay and live are mutually exclusive *user actions* in v1 (you either watch a live run OR replay a completed one — you don't replay a still-running run into the same view), full de-dup across two concurrent sources is rarely hit. The robust-but-simple rule: **when replaying/hydrating a run that is already terminal (status done/failed), there is no live tail — just render the history.** De-dup only matters for the late-join-into-a-live-run case, which v1 can treat as "hydrate history, then if a live stream is also open, skip the first N live frames equal to the history length." Use `seq` from `/events` as the ordinal for the hydrated prefix; assign synthetic incrementing ordinals to live frames.

> **Planner directive:** the timeline reducer should accept events tagged with a `source: 'live' | 'history'` and a derived stable key `${kind}:${node ?? ''}:${ordinal}`. The ordinal comes from `seq` for history events and from append-position for live events. De-dup on that key. Unit-test this with a fixture where history `[seq 1..3]` overlaps a live tail `[3,4,5]` and assert the merged log is `[1,2,3,4,5]` with no duplicate `seq 3`. **This is the single most important piece of new logic in the phase and must be a pure, unit-tested function.**

### Auth on the stream hop [VERIFIED: console internal/proxy/flow.go + flowd auth.go]
- flowd's `Authenticator` is **optional** (`BearerTokenAuthenticator` with a static token; empty token = open). When set, it gates **every endpoint except `/healthz`** (`authBypass`). Bad/missing bearer → **401** (with `WWW-Authenticate: Bearer realm="flowd"`); wrong-length/mismatch → **403**.
- **The Phase-1 BFF flow director already injects it.** `internal/proxy/flow.go`: `r.Out.Header.Del("Authorization")` then `r.Out.Header.Set("Authorization", "Bearer "+cfg.FlowdToken)`; strips `X-Console-*` (`delConsoleHeaders`); `ModifyResponse` deletes any `Authorization`/`X-Echo-Auth` echo and runs `sseBufferingDefense`. [VERIFIED: source + `TestFlowDirector`.]
- **→ The console MUST NOT:** send any `Authorization`/bearer for flow calls; send `X-Console-*` to flowd (flowd is not scope-aware — it ignores them and the BFF strips them anyway). The `openSseStream` wrapper sets only `Content-Type` by default — correct as-is; **do not add auth headers in the flow SSE call.**
- flowd is **single-tenant from the console's view** — there is no per-operator scoping on flows/runs (unlike the memory gateway). All operators see all flows. (No tenant/user gate like MEM-08 applies here — FLOW reqs have no operator-context precondition.)

## Architecture Patterns

### System Architecture Diagram (data flow)
```
        ┌──────────────────── Browser (React 19 SPA) ────────────────────┐
 CRUD → │ FlowPage                                                        │
        │  ├─ FlowsTable ──(TanStack Query: ['flows'])── GET /api/flow/flows
        │  │     row click → setSearchParam(?flow=id)                     │
        │  ├─ FlowDetail (tabs: Definition / Runs / Edit)                 │
        │  │     ├─ FlowEditor (zod well-formed) → PUT/POST (mutation)    │
        │  │     │     base64-decode json on GET; send raw flow on PUT    │
        │  │     ├─ RunTrigger: [Run sync] [Run streamed] + inputs form   │
        │  │     └─ RunsHistory ──(Query ['runs',flowId])── GET .../runs  │
        │  │                                                              │
 RUN →  │  ├─ ── sync ──→ useMutation POST /run → render {outputs}        │
        │  │                                                              │
 STREAM→│  └─ TimelineView ◄── useRunStream (IMPERATIVE) ────────────┐    │
        │        reducer(eventLog) → render model                    │    │
        │        ├─ ConnectionState (streaming/closed/errored)       │    │
        │        ├─ per-node status map (from node_* events)         │    │
        │        ├─ auto-scroll (pauses on manual scroll-up)         │    │
        │        └─ same renderer for REPLAY (POST .../replay)       │    │
        │             + late-join hydrate GET .../events (de-dup)    │    │
        └───────────────┬───────────────────────────────────────────┘    │
                        │ same-origin fetch  POST /api/flow/.../run/stream │
                        │ (NO bearer, NO X-Console-*)                      │
                        ▼                                                  │
        ┌──────────── Go BFF (httputil.ReverseProxy) ────────────┐        │
        │ flow director: strip Authorization + X-Console-*;       │        │
        │ inject Bearer <FLOWD_TOKEN>; ModifyResponse scrubs auth │        │
        │ + sseBufferingDefense (X-Accel-Buffering:no on SSE);    │        │
        │ StripPrefix /api/flow ; auto-flush text/event-stream    │        │
        └───────────────┬─────────────────────────────────────────┘       │
                        │  (fronting nginx: proxy_buffering off, gzip off, │
                        │   proxy_read_timeout 3600s on ~* ^/api/.*stream) │
                        ▼  HTTP + SSE (pure event:/data:, no heartbeat)    │
        ┌──────────── flowd :7861 (New(cfg).Handler, FIXED) ──────┐        │
        │ /flows CRUD · /run · /run/stream · /runs · /runs/{id}   │        │
        │ /events · /replay · /healthz(open) · optional bearer    │        │
        │ persists every event (seq) BEFORE forwarding on stream  │        │
        └──────────────────────────────────────────────────────────┘       │
```

### Recommended feature structure (slice-based, MVP mode — mirrors Phase-2 layout)
```
src/features/flow/
├── api/
│   ├── client.ts          # typed /api/flow/* fetchers (listFlows, getFlow, putFlow, createFlow, deleteFlow, runSync, listRuns, getRun, listEvents)
│   ├── stream.ts          # runStream(flowId, inputs, handlers) + replayStream(runId, handlers) over openSseStream
│   ├── schemas.ts         # zod: flowMeta, flowRecord, runMeta, runRecord, runEvent, sseEventPayload, flowdError
│   └── queries.ts         # useFlowsQuery, useFlowQuery, useRunsQuery, useRunQuery, useRunEventsQuery, query-key factory
├── timeline/
│   ├── reducer.ts         # PURE: (state, TimelineEvent) → state; per-node status; de-dup by (kind,node,ordinal)
│   ├── reducer.test.ts    # the keystone unit tests (live, replay, late-join de-dup, terminal close)
│   ├── connection.ts      # connection-state machine (idle→streaming→closed|errored; Phase-5 adds reconnecting)
│   └── useRunStream.ts    # imperative hook: opens stream, feeds reducer, AbortController on unmount/terminal
├── components/
│   ├── FlowsTable.tsx     # react-table over GET /flows (client sort/page)
│   ├── FlowEditor.tsx     # JSON editor (zod well-formed); base64-decode on load; create|edit modes
│   ├── RunTrigger.tsx     # inputs form + [Run sync] / [Run streamed]
│   ├── TimelineView.tsx   # renders the reducer's model; auto-scroll-pause; connection badge; per-node status
│   ├── RunsHistory.tsx    # react-table over GET /flows/{id}/runs
│   ├── RunDetail.tsx      # GET /runs/{id} summary + Timeline (replay) + RawJsonViewer
│   └── NodeStatusList.tsx # per-node status aggregation render
└── routes/
    └── flow.tsx           # route + searchSchema (flow, run, tab)
```

### Vertical slices (MVP build order)
1. **Slice A — flow CRUD REST (FLOW-01, FLOW-02):** flows list table + detail + create/edit JSON editor (base64-decode round-trip, zod well-formedness, PUT id-match) + delete-confirm. **No SSE.** Proves the `/api/flow/*` REST path + reuses every Phase-2 pattern (query-key factory, zod editor, destructive dialog, refetch-after-mutate). Ship first — lowest risk.
2. **Slice B — first streamed run + live timeline (FLOW-03, FLOW-04) [THE KEYSTONE]:** sync run path (simple) + the imperative `useRunStream` hook → pure timeline reducer → `TimelineView` with the connection-state machine, per-node status, and auto-scroll-pause. **This is where the SSE-through-BFF gets proven end-to-end against real flowd** (Phase 1 only proved the synthetic transport). Done-definition: a streamed run renders incrementally through the BFF, terminal `flow_done`/`flow_err` closes the stream + flips connection state, and the reducer + connection machine are unit-tested.
3. **Slice C — run history + replay in the same renderer (FLOW-05, FLOW-06):** runs-history table + run detail + replay through the *same* reducer/`TimelineView`, with `GET /events` late-join hydration de-duped against any live tail. Done-definition: replaying a completed run renders the identical timeline, and the de-dup function passes its overlap unit test.

### Pattern: imperative SSE hook feeding a pure reducer (the core new pattern)
```ts
// Source: flowd writeSSE frame schema + Phase-1 openSseStream + PROJECT.md "streams bypass Query"
function useRunStream() {
  const [state, dispatch] = useReducer(timelineReducer, initialTimeline)
  const [conn, setConn] = useState<ConnState>('idle')
  const abortRef = useRef<AbortController | null>(null)

  const start = useCallback((flowId: string, inputs: Record<string,string>) => {
    const ac = new AbortController(); abortRef.current = ac
    setConn('streaming'); dispatch({ type: 'reset' })
    openSseStream({
      url: `/api/flow/flows/${flowId}/run/stream`,
      method: 'POST',
      body: JSON.stringify({ inputs }),       // NO auth/X-Console-* headers
      signal: ac.signal,
      onMessage: ({ event, data }) => {
        const payload = JSON.parse(data)       // streamPayload shape
        dispatch({ type: 'event', source: 'live', kind: event!, payload })
        if (event === 'flow_done' || event === 'flow_err') {
          setConn('closed'); ac.abort()        // terminal → close
        }
      },
      onError: () => setConn('errored'),       // Phase-5 will add reconnect here
    }).catch(() => { /* fetchEventSource throws on abort — ignore post-terminal */ })
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])  // close on unmount
  return { timeline: state, conn, start }
}
```

### Pattern: pure timeline reducer (unit-testable; serves live + replay)
```ts
// Source: flowd 6-kind schema; de-dup by (kind,node,ordinal) since no seq in SSE frames
type TimelineEvent = { kind: SseKind; node?: string; payload: SsePayload; ordinal: number; source: 'live'|'history' }
function timelineReducer(state: Timeline, action: Action): Timeline {
  switch (action.type) {
    case 'reset': return initialTimeline
    case 'event': {
      const key = `${action.kind}:${action.payload.node ?? ''}:${nextOrdinal(state, action)}`
      if (state.seen.has(key)) return state            // de-dup (late-join overlap)
      const ev = { ...action, ordinal: /* seq for history, append-pos for live */ }
      return {
        events: [...state.events, ev],
        seen: new Set(state.seen).add(key),
        nodeStatus: applyNodeStatus(state.nodeStatus, action),  // node_started→running, node_finished→done, node_skipped→skipped
        terminal: action.kind === 'flow_done' ? 'done'
                : action.kind === 'flow_err'  ? 'error' : state.terminal,
      }
    }
  }
}
```

### Anti-Patterns to Avoid
- **Driving the SSE stream through TanStack Query.** Streams are append-only event logs; Query has no streaming model. Drive imperatively; use Query only for the surrounding REST (locked: PROJECT.md SSE section).
- **Expecting `id:`/`retry:`/`Last-Event-ID` reconnect.** flowd emits none and honors none. Reconnect (Phase 5) must re-`/replay` or re-`/events`-hydrate, not resume by event id.
- **Adding a client bearer or `X-Console-*` to flow calls.** The BFF injects the flowd token; the console sends neither (the director strips both). Adding them is at best a no-op, at worst a confused-deputy smell.
- **Treating the `FlowRecord.json` field as inline JSON.** It is Go `[]byte` → base64 string. Decode before editing; send raw flow JSON (not base64) on PUT.
- **Sending `id` in a PUT body that differs from the URL id.** flowd 400s. Omit `id` or match it.
- **Parsing a body on DELETE.** It returns 204 No Content — success is the status code, not a JSON body.
- **Building two renderers for live vs replay.** Frames are byte-identical; one reducer/renderer is required by success criterion 5.
- **Assuming a heartbeat keeps idle streams alive.** None exists. Idle survival is purely the nginx `proxy_read_timeout 3600s`. A node silent longer than that drops the connection — recover via replay/hydrate, don't assume the stream stays open forever.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE-over-POST framing/parsing | Custom `fetch`+`ReadableStream` line parser | `@microsoft/fetch-event-source` via the existing `openSseStream` | Already installed + wrapped (`sse.ts`); handles POST, headers, abort, frame parsing |
| Flow/runs list sort/page | Custom array sort+slice | `@tanstack/react-table` client models | In stack; same as Phase-2 ResultsTable |
| REST cache + invalidation after a run | `useState` + manual fetch | TanStack Query `invalidateQueries(['runs',flowId])` after a run completes | Locked stack; runs list refresh is exactly its invalidation API |
| JSON well-formedness in the editor | Custom validator | `JSON.parse` try/catch + zod `.parse` of the envelope | flowd is the authoritative *semantic* validator (compileProbe); client only checks well-formedness |
| Confirm dialog / toasts / drawer / tabs / badges | Bespoke components | Phase-1 sonner + shadcn dialog/sheet/tabs/badge | Built Phase 1/2; reuse the design contract |
| Connection-state + terminal-close | Ad-hoc booleans scattered in the component | A small explicit state machine (`idle→streaming→closed|errored`) | Phase 5 extends it with `reconnecting`; a typed machine makes that a clean addition |

**Key insight:** The only genuinely new logic in this phase is **(a) the imperative SSE hook + (b) the pure timeline reducer with (kind,node,ordinal) de-dup + (c) the connection-state machine**. Everything else is "wire the locked stack to a verified contract" exactly as Phase 2 did. Keep (a)/(b)/(c) as small, pure, unit-tested units so the keystone risk is provable without a live flowd.

## Runtime State Inventory

Not a rename/refactor/migration phase — this is a greenfield feature slice. Section omitted by trigger rule. (No stored data, service config, OS state, secrets, or build artifacts are renamed or migrated. The flowd `FLOWD_TOKEN` is consumed by the existing Phase-1 BFF config, unchanged.)

## Common Pitfalls

### Pitfall 1: Idle stream drop on a slow node (THE keystone risk)
**What goes wrong:** A `node_started` fires, the node calls a slow LLM/tool for 90s emitting nothing, and an intermediary (nginx/LB) with a short idle timeout kills the connection — the timeline freezes mid-run with no terminal event.
**Why it happens:** flowd emits NO heartbeat between events; the BFF injects none; idle survival is purely `proxy_read_timeout`.
**How to avoid:** (1) Deploy: ensure the fronting nginx `proxy_read_timeout` (3600s in Phase-1 `deploy/nginx.conf`) exceeds the longest silent step on the SSE location — **and verify the *deploy-environment* LB has the same** (Phase 6 / Open Q2). (2) Client: detect the drop via the connection-state machine (`onError` → `errored`), surface it visibly, and offer recover-via-replay (Phase 5 automates reconnect). **Do NOT assume the stream stays open indefinitely.**
**Warning signs:** Timeline stalls after a `node_started` with no `node_finished`; `onError` fires before any `flow_done`/`flow_err`.

### Pitfall 2: De-duping replay/late-join with a non-existent event id
**What goes wrong:** The planner assumes each SSE frame has a stable `seq`/`id` to de-dup on; it doesn't — de-dup silently fails and the timeline shows doubled events after a hydrate.
**Why it happens:** `seq` lives only in `GET /events` JSON; the SSE `data:` payload (`streamPayload`) omits it.
**How to avoid:** De-dup on `(kind, node, ordinal-within-(kind,node))`; ordinal = `seq` for history events, append-position for live events. Because flowd persists before forwarding, history is always a prefix of the live stream — never reordered. Unit-test the overlap case.
**Warning signs:** Doubled timeline rows when replaying or hydrating a run that also had a live tail.

### Pitfall 3: Treating `FlowRecord.json` as inline JSON
**What goes wrong:** The editor shows a base64 blob instead of the flow text; PUT sends base64 back and flowd 400s on compile.
**Why it happens:** `FlowRecord.JSON` is Go `[]byte` → base64-encoded in the HTTP response by default.
**How to avoid:** base64-decode `json` on GET to populate the editor; send the *raw* flow JSON under `flow` (json.RawMessage) on PUT/POST. **Verify empirically against a live `GET /flows/{id}`** (Open Q1) — if flowd added a custom MarshalJSON it'd be inline; none found in source.
**Warning signs:** Editor shows `eyJpZCI6...`; PUT returns `400 flow compile: ...`.

### Pitfall 4: PUT body id ≠ URL id
**What goes wrong:** Edit-save 400s with `body id %q does not match URL id %q`.
**Why it happens:** flowd rejects a body `id` that disagrees with the URL.
**How to avoid:** Omit `id` from the PUT body, or set it equal to the URL id. Same for the inner `flow.id`.
**Warning signs:** 400 on save after the flow text round-tripped fine through the editor.

### Pitfall 5: Parsing a body on DELETE
**What goes wrong:** Delete "fails" because the handler tries to `res.json()` a 204 No Content (empty body) and throws.
**Why it happens:** flowd DELETE returns 204, not a JSON envelope.
**How to avoid:** Treat 204 as success; do not parse a body. (Memory DELETE returned a JSON body; flow DELETE does not — different contract.)
**Warning signs:** Delete shows an error toast despite the flow actually being gone (refetch shows it removed).

### Pitfall 6: `flow_err` mid-stream not treated as terminal
**What goes wrong:** The reducer keeps the connection "streaming" after `flow_err`, never closing the AbortController → a leaked fetch.
**Why it happens:** `flow_err` is terminal (the engine emits it then closes `ch`), but it carries an `error` payload that's easy to mistake for a non-terminal node error.
**How to avoid:** Both `flow_done` AND `flow_err` are terminal — both must flip connection state to closed/errored and abort. (Node-level errors surface as `flow_err` too, since `runWithStore` only closes the channel after the engine ends.)
**Warning signs:** Connection badge stuck on "streaming" after an error; an aborted-stream warning on unmount.

### Pitfall 7: Empty `/events` mistaken for an error
**What goes wrong:** A just-created run with no events yet (or an unknown run) returns `200 {"events":[]}` and the UI shows an error.
**Why it happens:** `GET /events` is idempotent — empty, not 404, for unknown/empty runs (verified test).
**How to avoid:** Five-state: empty events → empty/loading state, not error. (404 only comes from `/replay` and `GET /runs/{id}`, not `/events`.)

## Code Examples

### Flow create/edit (base64-aware round-trip)
```ts
// Source: flowd createFlowRequest + FlowRecord.JSON []byte (base64) + compileProbe 400
async function getFlow(id: string) {
  const res = await fetch(`/api/flow/flows/${id}`)
  if (!res.ok) throw await parseFlowdError(res)
  const rec = await res.json() as { id: string; name?: string; json: string }
  const flowText = atob(rec.json)               // []byte → base64 → text (verify vs live: Open Q1)
  return { ...rec, flow: JSON.parse(flowText) }
}
async function putFlow(id: string, flow: unknown, name?: string) {
  const res = await fetch(`/api/flow/flows/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, flow }),       // NO id (URL is source of truth); raw flow, not base64
  })
  if (!res.ok) throw await parseFlowdError(res) // 400 flow compile / id-mismatch
  return res.json()                              // FlowRecord
}
async function deleteFlow(id: string) {
  const res = await fetch(`/api/flow/flows/${id}`, { method: 'DELETE' })
  if (!res.ok) throw await parseFlowdError(res)
  // 204 No Content — do NOT res.json()
}
```

### Sync run
```ts
// Source: flowd handleRun → runResponse{outputs, run_id}, X-Run-ID header
async function runSync(flowId: string, inputs: Record<string,string>) {
  const res = await fetch(`/api/flow/flows/${flowId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs }),
  })
  if (!res.ok) throw await parseFlowdError(res)  // {error:"..."}
  return res.json() as Promise<{ outputs: Record<string,string>; run_id: string }>
}
```

### Replay into the same timeline reducer
```ts
// Source: flowd handleReplayRun → byte-identical SSE frames; same reducer as live
function replayRun(runId: string, dispatch: Dispatch<Action>, signal: AbortSignal) {
  return openSseStream({
    url: `/api/flow/runs/${runId}/replay`,
    method: 'POST',
    body: '{}',
    signal,
    onMessage: ({ event, data }) =>
      dispatch({ type: 'event', source: 'history', kind: event!, payload: JSON.parse(data) }),
  })
}
```

### flowd error parse (different envelope from the gateway)
```ts
// Source: flowd writeError → errorResponse{Error string} — NOT the gateway's {error:{code,message,...}}
async function parseFlowdError(res: Response) {
  const body = await res.json().catch(() => ({ error: res.statusText }))
  // flowd shape: { "error": "human message" } — a flat string, no code/request_id
  return new FlowdError(res.status, (body as { error?: string }).error ?? res.statusText)
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Native `EventSource` (GET) | `@microsoft/fetch-event-source` (POST + headers + abort) | Forced by POST stream endpoints | The only viable SSE client; already wrapped in `sse.ts` |
| Reconnect via `Last-Event-ID` | Re-`/replay` or `/events`-hydrate | flowd emits no id/retry (verified) | Phase-5 reconnect must re-stream, not resume by id |
| Stream through cache/store | Imperative stream → local reducer | PROJECT.md locked decision | Clean separation: Query for REST, reducer for streams |
| Two renderers (live/replay) | One reducer, byte-identical frames | flowd `writeSSERaw` design | Success criterion 5 satisfied structurally |

**Deprecated/outdated:** none — greenfield against a current, source-verified contract. (Note the **gateway error envelope `{error:{code,message,...}}` from Phase 2 does NOT apply here** — flowd uses a flat `{"error":"string"}`. Do not reuse Phase-2's `parseGatewayError` for flow calls.)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `FlowRecord.json` serializes as a base64 string (Go default `[]byte` encoding); editor must decode | Flow CRUD contract / Pitfall 3 | **MEDIUM** — if flowd added a custom MarshalJSON (none found in store.go) it'd be inline JSON instead. Planner must verify against one live `GET /flows/{id}` before finalizing the editor decode path. Cheap to verify; wrong assumption = blank/garbled editor. |
| A2 | shadcn `tabs`/`sheet` are the right detail-surface primitives | Standard Stack | Low — official blocks; confirm at `shadcn add` time; trivial swap |
| A3 | The umbrella deploys flowd via `New(cfg).Handler()` (store-backed), not legacy `NewMux` | Routes | Low-MEDIUM — CRUD/history/replay only exist on the store-backed surface; if the deploy used `NewMux`, only `/run`+`/run/stream` would exist and FLOW-01/02/05/06 would be impossible. Verify flowd's wiring in the umbrella compose. |
| A4 | The deploy-environment LB/proxy `proxy_read_timeout` covers the longest silent node step | Keystone risk / Pitfall 1 | **MEDIUM** — Phase-1 nginx sets 3600s, but the actual umbrella fronting proxy/LB is Phase-6/environment-specific (ROADMAP Phase-6 research flag). A short timeout silently drops idle streams. |
| A5 | flowd listens on `:7861` and is reachable from the BFF at `cfg.FlowBase` | Architecture | Low — `:7861` per task context/PROJECT inventory; the BFF `FlowBase` is Phase-1 config. Verify the compose wiring. |

## Open Questions (RESOLVED)

> Disposition: Q1 + Q2 → routed to `03-VALIDATION.md` "Manual-Only Verifications" as acceptance gates (empirical/environment checks a unit test can't supply); Q3 → resolved inline (v1 raw-JSON editor, no client-side IR schema). None block planning.

1. **`FlowRecord.json` wire encoding (base64 vs inline).** — RESOLVED → manual gate (A1).
   - What we know: `FlowRecord.JSON` is Go `[]byte` (store.go); Go's default JSON encoding base64-encodes `[]byte`; no custom MarshalJSON found.
   - What's unclear: whether a marshaler elsewhere overrides this (the SQLite store or a transport wrapper).
   - Recommendation: planner adds a one-line empirical check (`curl /api/flow/flows/<id> | jq .json`) before coding the editor decode; default to base64-decode per A1.

2. **Deploy-environment idle-timeout for SSE (the residual keystone risk).**
   - What we know: Phase-1 `deploy/nginx.conf` sets `proxy_read_timeout 3600s` on the SSE location; flowd/BFF inject no heartbeat.
   - What's unclear: whether the *umbrella's actual fronting proxy/LB* (Phase 6, environment-specific) matches — the through-nginx leg of the BFF-03 gate was deferred in Phase 1 (Docker registry unreachable in the sandbox).
   - Recommendation: this phase's live e2e must run the through-nginx SSE proof against real flowd (closes the deferred BFF-03 PART 2 + the auth-on-stream gate). Document the required LB idle-timeout for Phase 6. Treat as the phase's primary acceptance gate.

3. **flow IR shape for the editor / sample flows.**
   - What we know: the flow body has top-level `id`, `name`, `nodes`, `edges`, `inputs`, `outputs` (from test fixtures `echoChainFlow`/`routerFlow` in server_events_test.go); `compileProbe` is the authoritative validator.
   - What's unclear: full node/edge schema for client-side hints (out of v1 scope — v1 edits raw JSON, no DAG builder per REQUIREMENTS Out-of-Scope).
   - Recommendation: v1 raw-JSON editor with well-formedness only; surface flowd's compile 400 message verbatim. No client-side IR schema needed.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| flowd running (`New(cfg)`, `:7861`) | All FLOW flows end-to-end | Runtime/deploy concern | — | Vitest mocks the `/api/flow/*` fetch + a fake SSE stream; manual e2e needs flowd + the compose stack up |
| Phase-1 BFF flow director + `sse.ts` | Everything (substrate) | **Built** (Phase 1 complete) | — | None needed — verified present (`internal/proxy/flow.go`, `web/src/lib/sse.ts`) |
| Phase-2 patterns (query-key factory, zod editor, confirm dialog, FiveStateWrapper) | CRUD slice | **Built** (Phase 2 complete) | — | Reuse directly |
| nginx with SSE hardening | Live SSE e2e through a real proxy | Config built; through-proxy leg deferred (Docker registry blocked in sandbox) | — | Run the through-nginx proof on a host with registry access (Phase-1 SUMMARY documents the exact command) |

**Missing dependencies with no fallback:** None blocking — Phase 1 + Phase 2 substrate is built and verified present. The only environment gap is the deferred through-nginx SSE proof (Open Q2), which is this phase's acceptance gate, not a code dependency.

**Missing dependencies with fallback:** Live flowd for tests → Vitest + a mock `fetchEventSource` / fake event-stream emitting the documented 6-kind frame schema (the `server_events_test.go` golden sequences are ready-made fixtures).

## Validation Architecture

> nyquist_validation is `true` in config.json — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.x + @testing-library/react [CITED: PROJECT.md STACK; established Phase 1, used Phase 2] |
| Config file | established Phase 1 (`web/`); reuse — no Wave 0 framework install |
| Quick run command | `cd web && npx vitest run src/features/flow` |
| Full suite command | `cd web && npx vitest run` |

### How to test an imperative SSE client deterministically (the central testing concern)
The keystone logic must be provable **without a live flowd**. Two layers:
1. **Pure reducer + connection machine (no I/O):** unit-test `timelineReducer` and the connection-state machine as pure functions over arrays of `{kind, payload}` fixtures derived from the `server_events_test.go` golden sequences (`flow_started → node_started → node_finished → ... → flow_done`, and the failure variant ending in `flow_err`, and the `node_skipped` variant). **No mock needed** — feed events, assert render model + per-node status + terminal state + de-dup.
2. **The imperative hook (`useRunStream`) with a fake SSE source:** mock `@microsoft/fetch-event-source`'s `fetchEventSource` (or the `openSseStream` wrapper) so a test can push a scripted sequence of frames and an optional `onerror`/abort. Assert: frames dispatch into the reducer in order; `flow_done`/`flow_err` flips connection state + aborts; unmount aborts. **Mock the wrapper, not the network** — `vi.mock('@microsoft/fetch-event-source')` returning a controllable emitter is the cleanest seam. (MSW is already a dev dep and *can* emit SSE, but mocking the wrapper is simpler and avoids real network framing.)
3. **De-dup test (the most important):** feed history `[seq 1,2,3]` then a live tail `[3,4,5]` and assert the merged log is `[1,2,3,4,5]` with `seq 3` appearing once. This proves success criterion 5's late-join requirement.
4. **Auto-scroll-pause:** component test with `@testing-library/react` — render `TimelineView`, append events (asserts auto-scroll intent), simulate a manual scroll-up (sets a `paused` flag), append more, assert it does NOT auto-scroll while paused. (jsdom has no real layout; assert the *intent*/state flag, not pixel scroll — e.g. that `scrollIntoView`/scroll-to-bottom is called when not paused and skipped when paused. Note Phase-1 SUMMARY: jsdom lacks `scrollTo` — stub it.)

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FLOW-01 | Flows list renders rows; row → detail nav | component | `npx vitest run src/features/flow/FlowsTable.test.tsx` | ❌ Wave 0 |
| FLOW-02 | Editor base64-decodes on load; PUT round-trips; zod rejects malformed JSON; compile-400 surfaces in toast | component+unit | `npx vitest run src/features/flow/FlowEditor.test.tsx` | ❌ Wave 0 |
| FLOW-02 | Delete shows confirm; treats 204 as success (no body parse) | component | `npx vitest run src/features/flow/FlowEditor.test.tsx` | ❌ Wave 0 |
| FLOW-03 | Sync run renders `{outputs}`; failure renders `error` | unit | `npx vitest run src/features/flow/client.test.ts` | ❌ Wave 0 |
| FLOW-04 | Reducer: 6-kind golden sequence → correct render model + per-node status + terminal | unit | `npx vitest run src/features/flow/timeline/reducer.test.ts` | ❌ Wave 0 |
| FLOW-04 | Connection machine: streaming→closed on flow_done, →errored on flow_err/onError; abort on unmount | unit | `npx vitest run src/features/flow/timeline/connection.test.ts` | ❌ Wave 0 |
| FLOW-04 | Imperative hook dispatches scripted frames; terminal aborts | unit | `npx vitest run src/features/flow/timeline/useRunStream.test.ts` | ❌ Wave 0 |
| FLOW-04 | Auto-scroll pauses on manual scroll-up | component | `npx vitest run src/features/flow/TimelineView.test.tsx` | ❌ Wave 0 |
| FLOW-05 | Runs history renders status+timestamps; run detail renders summary | component | `npx vitest run src/features/flow/RunsHistory.test.tsx` | ❌ Wave 0 |
| FLOW-06 | Replay feeds the SAME reducer; identical render to live | unit | `npx vitest run src/features/flow/timeline/reducer.test.ts` | ❌ Wave 0 |
| FLOW-06 | Late-join de-dup: history[1,2,3] + live[3,4,5] → [1,2,3,4,5] | unit | `npx vitest run src/features/flow/timeline/reducer.test.ts` | ❌ Wave 0 |
| FLOW-06 | Empty `/events` → empty state, not error | component | `npx vitest run src/features/flow/RunDetail.test.tsx` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cd web && npx vitest run src/features/flow`
- **Per wave merge:** `cd web && npx vitest run`
- **Phase gate:** full suite green + the live through-nginx SSE proof against real flowd (Open Q2) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/features/flow/api/schemas.ts` — zod fixtures from the verified DTO shapes (FlowRecord, RunMeta, RunRecord, RunEvent, the 6-kind SSE payload)
- [ ] `src/test/mocks/flowd.ts` — fetch-mock handlers for `/api/flow/*` REST (incl. a 400 compile error, a 409 duplicate, a 204 delete, an empty `/events`)
- [ ] `src/test/mocks/fetch-event-source.ts` — controllable fake SSE emitter (`vi.mock('@microsoft/fetch-event-source')`) scripting the golden frame sequences (success, failure, node_skipped, late-join overlap)
- [ ] Reuse the Phase-1 QueryClient test wrapper + jsdom `scrollTo` stub (do not re-create)

*(Vitest + RTL + QueryClient wrapper were established Phase 1 and exercised Phase 2 — only flow-specific fixtures/mocks/test files are new. No framework install.)*

## Security Domain

> security_enforcement not present in config.json → treated as enabled. Section included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | partial | The **flowd bearer is injected at the BFF** (Phase-1 `flow.go`); the console fires NO auth on flow calls. The optional operator token is consumed at the app layer, never forwarded to flowd. |
| V3 Session Management | no | Internal tool; no in-app session/cookie. flowd runs are stateless from the console's view (run_id is a handle, not a session). |
| V4 Access Control | yes | **Stream-hop auth boundary** — the console must NEVER send a bearer or `X-Console-*` to flowd; the BFF director strips inbound `Authorization` + `X-Console-*` and injects the configured flowd token. flowd is single-tenant (no per-operator scoping on flows/runs). |
| V5 Input Validation | yes | Flow JSON well-formedness via zod (client) + `compileProbe` (flowd authoritative). **Event payloads (`output`/`error`/`metadata` strings) rendered as TEXT nodes** — never HTML. Run inputs are string→string only. |
| V6 Cryptography | no | No crypto in the console; the flowd token + operator token stay server-side (Phase-1 D-01). |

### Known Threat Patterns for React-SPA + Go-BFF + fixed flowd (+ SSE)
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stored/streamed XSS via event `output`/`error`/`metadata` or flow `name` rendered as HTML | Tampering / Elevation | Render ALL flowd strings (event payloads, node outputs, error messages, flow names) as **React text nodes** (default-escaped); the timeline + raw-JSON viewer show escaped text; never `dangerouslySetInnerHTML`. This is heightened here because event payloads stream from arbitrary node outputs (LLM/tool text). |
| flowd token leaking to the browser via SSE response headers | Info disclosure | Phase-1 `ModifyResponse` deletes `Authorization`/`X-Echo-Auth` on flow responses (incl. SSE); console never sees the token. Console adds no client bearer. |
| Confused-deputy via client-set auth/scope on flow calls | Spoofing | BFF director strips inbound `Authorization` + `X-Console-*` before injecting the flowd token; console sends neither. |
| SSRF / open proxy via unmapped flow routes | Tampering | BFF allowlists `/api/flow/*` → flowd root only (Phase-1 `router.go` StripPrefix); console never constructs arbitrary upstream URLs. flowd path params are server-side route matches, not proxy targets. |
| Detached/leaked upstream run on client disconnect | DoS / resource | The imperative hook aborts the `fetch` on terminal/unmount → flowd's `r.Context()` cancels → engine stops (flowd respects `r.Context().Err()` in the replay loop and `RunStream(r.Context(), ...)`). Always wire the AbortController. |
| Replaying/listing another run's events (cross-run leak) | Info disclosure | Not applicable in v1 — flowd is single-tenant, all operators see all runs (internal ops tool, REQUIREMENTS Out-of-Scope: no per-user RBAC). Auth lives at the BFF/ingress. |

## Sources

### Primary (HIGH confidence)
- `../llm-agent-flow/cmd/flowd/server/server.go` — exact routes (`(*Server).Handler()`), all handlers, `writeSSE`/`writeSSERaw` (frame format), `streamPayload` (payload keys), `eventKindString` (6 kinds), `runWithStore` (persist-before-forward), `handleReplayRun`, `decodeJSON` DisallowUnknownFields, `flowHeaderFromBody` (id reconciliation), `compileProbe` (400 validation)
- `../llm-agent-flow/flow/store/store.go` — `FlowMeta`/`FlowRecord` (`JSON []byte`), `RunMeta`/`RunRecord`, `RunEvent` (`Seq`/`Kind`/`NodeID`/`Payload`/`Timestamp`), `RunEventKind` constants, `RunStatus`, `ListRunEvents` seq-order contract
- `../llm-agent-flow/cmd/flowd/server/auth.go` — `BearerTokenAuthenticator` (optional, empty=open), `authBypass` (/healthz open), `withAuth` (401/403 mapping)
- `../llm-agent-flow/cmd/flowd/server/server_events_test.go` — golden event sequences (success/failure/node_skipped), `seq` 1-indexed monotonic, `/events` unknown-run→200-empty
- `internal/proxy/flow.go` (+ `internal/proxy/memory.go` for `sseBufferingDefense`/`delConsoleHeaders`) — executed Phase-1 flow director: strip Authorization + X-Console-*, inject Bearer FLOWD_TOKEN, ModifyResponse scrub + SSE buffering defense
- `internal/router/router.go` — `/api/flow/` StripPrefix → flowd; `/api/config/env` exposes no secrets
- `web/src/lib/sse.ts` — the executed `openSseStream` wrapper over `fetchEventSource` (POST default, onMessage exposes `{data, event}`)
- `.planning/phases/02-memory-console/02-RESEARCH.md` — the contract-verification METHOD + patterns to mirror (query-key factory, zod editor, confirm dialog, FiveStateWrapper, feature/ layout)
- `.planning/phases/01-foundation/01-01-SUMMARY.md` / `01-04-SUMMARY.md` — Phase-1 SSE transport gate (nginx D-06: proxy_buffering off, gzip off, proxy_read_timeout 3600s, SSE location ordering), `openSseStream` stub, deferred through-nginx leg
- `.planning/{ROADMAP,REQUIREMENTS,PROJECT,STATE}.md` — phase goal, FLOW-01..06, locked stack, flowd inventory, keystone-risk blocker

### Secondary (MEDIUM confidence)
- `FlowRecord.json` base64 wire encoding (Go `[]byte` default) — inferred from the Go type, not yet confirmed against a live response (A1/Open Q1)

### Tertiary (LOW confidence)
- None — no unverified web claims relied upon; the entire contract was read from source.

## Metadata

**Confidence breakdown:**
- flowd contract (routes, DTOs, SSE frame schema, replay/auth semantics): **HIGH** — read from source + golden tests, not training data.
- Keystone risk (no heartbeat, idle survival via proxy_read_timeout, replay-not-Last-Event-ID): **HIGH** — `writeSSE`/`writeSSERaw`/`handleReplayRun` confirm no `:`/`id:`/`retry:`/`Last-Event-ID`.
- De-dup strategy (no seq in SSE frame; key on (kind,node,ordinal)): **HIGH** on the constraint (verified `streamPayload` omits seq); **MEDIUM** on the recommended algorithm (sound but unimplemented — must be unit-tested).
- Stream-hop auth (console does nothing): **HIGH** — executed `flow.go` director + `TestFlowDirector`.
- Standard stack: **HIGH** — locked Phase-1; no new packages; SSE client already installed + wrapped.
- `FlowRecord.json` encoding: **MEDIUM** — Go-type inference; verify against live (A1/Q1).
- Deploy-environment idle timeout: **MEDIUM** — Phase-1 nginx set; umbrella LB is Phase-6/environment-specific (A4/Q2).

**Research date:** 2026-06-03
**Valid until:** flowd contract is pinned by golden tests (stable; re-verify only if `../llm-agent-flow` CHANGELOG shows an SSE/route/DTO change). Stack: 30 days.
