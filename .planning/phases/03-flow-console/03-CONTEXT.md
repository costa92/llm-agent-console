# Phase 3: Flow Console - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 delivers the **Flow Console** — the **keystone SSE phase**. An operator:
- Manages flows as JSON: list / create / edit (PUT round-trip, JSON validated) / delete (with confirm) — FLOW-01.
- Triggers a **synchronous** run and sees its outputs/result — FLOW-02.
- Triggers a **streamed** run and watches a live append-only event timeline (node started/finished/skipped, terminal done/error), per-node status, auto-scroll that pauses on manual scroll, visible connection state — FLOW-03.
- Browses **run history** for a flow and opens a **run detail** (status + timestamps) — FLOW-04.
- **Replays** a completed run's events in the SAME timeline renderer used for live runs, with late-join events hydrated from `/events` then de-duped against the live stream — FLOW-05.
- (FLOW-06 — the SSE-through-BFF end-to-end proof — is satisfied by the streamed-run path proving Phase-1's deferred through-nginx leg against real flowd.)

Covers REQ **FLOW-01..06**. This is the first phase to render real SSE; it proves the BFF SSE pass-through end-to-end (closing Phase-1's deferred BFF-03 Part 2 against real flowd).

**NOT in this phase:**
- A visual drag-and-drop DAG editor (PROJECT.md out-of-scope; v1 edits flow JSON).
- Auto-reconnect/backoff + the SSE disconnected/reconnecting five-state (Phase 5 / SHELL-02) — Phase 3 ships manual Retry and designs the connection-state machine to EXTEND, not be rewritten.
- Chat streaming (Phase 4, reuses this phase's SSE infra).

**Contract is LOCKED by research** (`03-RESEARCH.md`, verified against real flowd source). This discussion settled the operator-facing HOW.

</domain>

<decisions>
## Implementation Decisions

### Live timeline layout (the keystone)
- **D-01:** **Timeline + node-status strip.** A vertical **append-only event timeline** (the frame stream — `flow_started`/`node_started`/`node_finished`/`node_skipped`/`flow_done`/`flow_err`) PLUS a compact **per-node status strip** that updates IN PLACE (pending→running→done/err/skipped), both fed by the same reducer over the same event stream.
- **D-02:** **Connection-state badge** in the timeline header — streaming / closed / errored (Phase 5 adds reconnecting on top; design the state machine to extend).
- **D-03:** **Auto-scroll that pauses on manual scroll** — the timeline auto-scrolls to the newest frame while live, but pauses when the operator scrolls up to inspect, and offers a "jump to latest" affordance to resume.

### Run trigger UX
- **D-04:** **Streamed primary + sync secondary, ONE result surface.** The primary "Run" button streams (the keystone path → live timeline). A secondary "Run (sync)" action does the blocking `POST /flows/{id}/run`. The sync result renders into the SAME terminal-frame/result panel the streamed run ends on — one result surface, not two parallel ones.

### Flow CRUD + JSON editor
- **D-05:** **Full-route flow detail + reused JSON editor.** Flows **list** (react-table) → a **full route** `/flows/{id}` (NOT a drawer — a flow detail carries far more than a memory item) hosting: the reused Phase-2 **raw-JSON + zod editor** (base64-decode `FlowRecord.json` on load, encode on PUT — research-flagged), the run controls, and run history. "New flow" opens the same editor blank/templated. Delete = the Phase-1 **red destructive confirm**.
- **D-06:** PUT round-trips the flow JSON (validated). flowd rejects a body `id` ≠ URL id and DELETE returns 204 (no body) — the planner handles these per research.

### Run history + replay
- **D-07:** **Instant-fill replay + history on the flow detail.** Run history is a **react-table list on the flow detail** (`/flows/{id}`). Opening a past run hydrates `GET /runs/{id}/events` and **INSTANT-FILLS** the timeline (no artificial playback) — the operator sees the whole run at once. **Same reducer/renderer as live**, de-duped on `(kind, node, ordinal)` (research: `seq` is NOT in the SSE frame; history is a clean prefix of live).

### Run view URL structure
- **D-08:** **Deep-linkable run sub-route `/flows/{id}/runs/{runId}`.** Live runs AND replays both render at this shareable sub-route (a live run gets its runId as soon as flowd creates it). Run-history rows link here; replay = navigate to the sub-route + instant-fill; browser-back returns to the flow detail. This also relieves the flow-detail route (editor + history on `/flows/{id}`; the run timeline on the run sub-route). Mirrors Phase-2's URL-sync deep-linking philosophy.

### Stream error handling
- **D-09:** **Distinguish flow_err from transport drop.** A flowd **`flow_err`** renders as a **terminal error frame IN the timeline** (the run genuinely failed — keep the partial timeline visible). A **transport drop** (connection lost, no terminal frame) flips the connection-state badge to **errored** with a **manual Retry** that re-opens the stream. Phase 5 adds auto-reconnect/backoff on top. An operator must never confuse a failed flow with a dropped connection.

### Claude's Discretion (+ research/planner-owned)
- The `(kind, node, ordinal)` de-dupe + the single timeline **reducer** design (live + replay) — research-specified; planner implements + unit-tests.
- **base64 `FlowRecord.json`** decode-on-load / encode-on-PUT — research-flagged (A1: verify against one live GET); planner owns.
- The **flat flowd error envelope** `{"error":"string"}` parser — do NOT reuse Phase-2's `parseGatewayError`; planner writes a flow-specific one (research).
- Exact auto-scroll-pause mechanics, node-status-strip rendering, and the connection-state badge visuals — per UI-SPEC.
- Whether the editor reuses Phase-2's `EditorDrawer` component or a route-hosted variant of the same raw-JSON+zod editor — planner/UI decide; the PATTERN (raw-JSON+zod, mono, inline parse errors) is locked.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 3 research (LOCKED contract — verified from flowd source)
- `.planning/phases/03-flow-console/03-RESEARCH.md` — THE flowd contract: exact routes/DTOs, the 6-kind SSE frame schema (one reducer for live+replay), heartbeat absence + the keystone idle-survival implication, replay/late-join + the `(kind,node,ordinal)` de-dupe constraint, stream-hop auth (console does nothing), and the gotchas (base64 `FlowRecord.json`, flat error envelope, DELETE 204, PUT id-mismatch).

### Project specs (locked)
- `.planning/PROJECT.md` — verified flowd route+auth inventory (flowd :7861; `GET/POST /flows`, `GET/PUT/DELETE /flows/{id}`, `POST /flows/{id}/run`, `POST /flows/{id}/run/stream` SSE, `GET /flows/{id}/runs`, `GET /runs/{id}`, `GET /runs/{id}/events`, `POST /runs/{id}/replay` SSE; optional bearer; `/healthz` open).
- `.planning/REQUIREMENTS.md` — FLOW-01..06.
- `.planning/ROADMAP.md` §"Phase 3: Flow Console" — goal + 5 success criteria + the SSE research note.

### Phase 1 substrate (build ON — do not re-create)
- `.planning/phases/01-foundation/01-01-SUMMARY.md` — the BFF SSE pass-through (synthetic `/api/stream/test`), `deploy/nginx.conf` D-06 hardening (`proxy_buffering off`, `gzip off`, `proxy_read_timeout 3600s`, `X-Accel-Buffering` passthrough), the BFF injects NO heartbeat. **This phase's streamed run closes Phase-1's deferred BFF-03 Part 2 against real flowd.**
- `.planning/phases/01-foundation/01-03-SUMMARY.md` — the **flow director** (`internal/proxy/flow.go`): `/api/flow/*` → flowd, strips inbound auth + `X-Console-*`, injects `Bearer <FLOWD_TOKEN>`, `ModifyResponse` scrubs echoes + `sseBufferingDefense`. **Console sends no bearer.**
- `.planning/phases/01-foundation/01-04-SUMMARY.md` — the `openSseStream` client stub (`web/src/.../sse.ts`) this phase implements; `@microsoft/fetch-event-source` (SSE-over-POST).

### Phase 2 patterns to mirror (the executed reference implementation)
- `web/src/features/memory/` — the `features/` layout: `api/{schemas,client,queries}.ts` (query-key factory, typed client through the X-Console-* fetcher), the raw-JSON+zod `EditorDrawer`, react-table list, FiveStateWrapper usage, the destructive-dialog + pessimistic patterns, `web/src/test/mocks/` harness. Mirror this structure for `web/src/features/flow/`.
- `.planning/phases/02-memory-console/02-RESEARCH.md` — the contract-verification METHOD + the TanStack-Query patterns (queries for REST CRUD; streams driven IMPERATIVELY outside the cache).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 1 (executed):** BFF flow director + nginx SSE hardening + `openSseStream` stub. The console calls same-origin `/api/flow/*`; auth is server-injected — the SPA does nothing special.
- **Phase 2 (executed):** the entire `web/src/features/memory/` reference — `features/` layout, query-key factory, typed client, raw-JSON+zod editor, react-table, FiveStateWrapper/RawJsonViewer/CopyableId/destructive-dialog/sonner, the mock-fetch test harness. Mirror into `web/src/features/flow/`.
- **Stack (CLAUDE.md):** `@microsoft/fetch-event-source` for SSE-over-POST (already a dep); TanStack Query for the REST CRUD (flows/runs lists + details) + invalidation; TanStack Router for the routes (`/flows`, `/flows/{id}`, `/flows/{id}/runs/{runId}`).

### Established Patterns
- **Streams are driven IMPERATIVELY**, NOT through TanStack Query cache (open on run-trigger, append to local reducer state, close on terminal `flow_done`/`flow_err`/unmount). Query handles only the surrounding REST.
- **One reducer + one renderer** for live and replay (research) — de-dupe `(kind,node,ordinal)`.
- Render all flowd event-payload strings as TEXT nodes (no `dangerouslySetInnerHTML`) — same XSS posture as Phase 2.
- Five-state per view; connection-state machine extends it (Phase 5 adds reconnecting).

### Integration Points
- **flowd** (`:7861`) over HTTP at the BFF-configured URL — the BFF does NOT import flowd packages; route+auth contract fixed (PROJECT.md / research).
- The streamed-run path is the **end-to-end SSE proof** that closes Phase-1's deferred through-nginx leg (A4) against real flowd. Confirm the umbrella runs the **store-backed** flowd server (`New(cfg)`, not legacy `NewMux`) — CRUD/history/replay only exist there (research A3).

</code_context>

<specifics>
## Specific Ideas

- **Three research open-questions the planner must resolve before locking** (`03-RESEARCH.md` §Open Questions):
  1. `FlowRecord.json` base64 vs inline — one-line `curl | jq` empirical check before coding the editor decode (A1).
  2. Deploy-environment SSE idle-timeout — this phase's e2e closes Phase-1's deferred through-nginx leg against real flowd (A4).
  3. Confirm the umbrella runs the store-backed flowd (`New(cfg)`), not legacy `NewMux` (A3).
- The SSE client must be testable deterministically WITHOUT a live flowd — pure reducer + mocked `fetchEventSource` + the late-join de-dupe overlap test + connection-state machine + auto-scroll-pause (research §Validation Architecture).
- flowd error envelope is flat `{"error":"string"}` — NOT Phase-2's gateway envelope; write a flow-specific parser.

</specifics>

<deferred>
## Deferred Ideas

- **Auto-reconnect / backoff + the SSE disconnected/reconnecting five-state** — Phase 5 (SHELL-02); Phase 3 ships manual Retry + an extensible connection-state machine.
- **Visual DAG / drag-and-drop flow builder** — PROJECT.md out-of-scope for v1 (JSON editing only).
- **Auto-play (timed) replay** — NOT chosen; D-07 is instant-fill (operators inspect, not watch). Recorded as a possible later affordance.
- **Cross-flow Runs page** — NOT chosen; D-07 keeps run history local to the flow detail. Possible later top-level view.
- None of the above expand phase scope.

</deferred>

---

*Phase: 03-flow-console*
*Context gathered: 2026-06-04*
