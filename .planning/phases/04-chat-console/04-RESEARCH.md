# Phase 4: Chat Console — Research

**Researched:** 2026-06-04
**Domain:** Streaming agent-step chat (SSE-over-POST) reusing the Phase-3 SSE substrate; session continuity; sync fallback
**Confidence:** HIGH (the chat wire contract was read directly from `../llm-agent-customer-support` Go source; the Phase-3 reuse surface was read directly from the executed console code)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Chat bubbles + collapsible inline step trace. User/assistant bubbles; the assistant turn streams its agent steps as a collapsible inline "step trace" (reusing the Phase-3 append/timeline renderer) live as they arrive, then collapses to the final answer on completion (re-expandable). A streaming indicator shows in the active assistant bubble while streaming; stop-on-error renders the error in-bubble (CHAT-01). Render all agent/chat strings as TEXT nodes (no `dangerouslySetInnerHTML`).
- **D-02:** Single active session + "New session". One active chat session; its id is shown via CopyableId in the header and reused across turns (CHAT-02). A "New session" button starts fresh. NO session-list/history (no browse endpoint). The exact session_id mechanic is research-gated (resolved below).
- **D-03:** Streamed default + sync toggle, ONE assistant bubble. Streaming (`/api/chat/stream`) is the default send path; a toggle sends the synchronous `/api/chat` one-shot instead (CHAT-03). The sync reply renders into the SAME assistant bubble the stream would fill — one message surface.
- **D-04:** Multi-line composer, Enter-sends + Stop. Multi-line input; Enter sends, Shift+Enter = newline; input disabled while a response streams; a Stop button cancels the in-flight stream via the Phase-3 abort seam (abort the fetch).
- **D-05:** Stop keeps the partial + "Stopped" marker. On Stop, the partial answer/steps stay in the assistant bubble with a clear "Stopped" marker; connection state → closed (operator-initiated, NOT an error).
- **D-06:** New session clears to a fresh empty conversation — the view resets to empty with a new session id; the prior transcript leaves the view (no history store). One session at a time.

### Claude's Discretion
- The exact `/chat` + `/chat/stream` contract (request/response shapes, the streamed agent-step frame schema, terminal/done framing, the session_id mechanic) — research MUST verify against `../llm-agent-customer-support/internal/httpapi/httpapi.go` (the `writeSSE` chat path) before the planner locks the renderer/session wiring. **→ RESOLVED in this document, see "The Verified Chat Contract".**
- How much of the Phase-3 SSE infra reuses cleanly vs needs a thin chat adapter — planner decides reuse-vs-adapt (a generic stream hook + a chat-specific reducer/renderer, or a thin wrapper over `useRunStream`). **→ RECOMMENDATION below: reuse `lib/sse.ts` + `connection.ts` verbatim; write a chat-specific `useChatStream` hook + `turnsReducer` — do NOT wrap `useRunStream`.**
- Step-trace collapse default + re-expand toggle visuals; where the sync/stream toggle lives in the composer — per UI-SPEC.
- Streaming indicator + "Stopped"/error in-bubble visuals — per UI-SPEC (reuse Phase-1/3 status tokens).

### Deferred Ideas (OUT OF SCOPE)
- Session-history list / switcher — no browse endpoint; v1 single-active-session (D-02).
- Reconnect / backoff — Phase 5 (SHELL-02); this phase ships manual Stop + the extensible connection machine.
- Keeping prior transcript visible across "New session" — NOT chosen (D-06 clears to fresh).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHAT-01 | Operator sends a message and watches streamed agent steps (`POST /chat/stream`) render incrementally, with a streaming indicator and stop-on-error. | Verified `event: step` frames carry `{kind, answer}`; terminal `done`/`error` framing confirmed. Reuse Phase-3 `openSseStream` + `connection.ts`; new `turnsReducer` folds `step`→trace rows, `done`→final answer, `error`→in-bubble red. Stop via the Phase-3 `AbortController` seam. |
| CHAT-02 | Chat maintains session continuity (reuses the session id across turns). | Verified: server returns `X-Session-Id` response header (set BEFORE first frame on the stream path) AND `session_id` in the sync JSON body. Console reads it via `onOpen(response)` (stream) / response body (sync), shows it via CopyableId, and sends it back as the request **body** field `session_id` on the next turn. |
| CHAT-03 | Operator can use a sync fallback (`POST /chat`) for one-shot messages, reusing the same message rendering. | Verified sync `POST /chat` → `{answer, agent, session_id}`. Renders into the SAME assistant bubble (no step trace for sync). REST call (not SSE); local state, not TanStack Query, so it shares the turn-state surface. |
</phase_requirements>

## Summary

Phase 4 is the lightest feature slice and the third consumer of the Phase-3 SSE substrate. The entire chat wire contract was verified by reading the actual Go source of the customer-support service (`../llm-agent-customer-support/internal/httpapi/httpapi.go`) and the agent step contract (`../llm-agent-contract/agents/agent.go`). No ambiguity remains: the streamed frames are SSE **named events** `step` / `done` / `error`, each a JSON `StreamEnvelope{kind, answer, error}`; the session id is **server-assigned** (a UUID when the request omits it), returned in the **`X-Session-Id` response header** on both endpoints and additionally in the sync `/chat` JSON body, and **reused by sending it back in the request body field `session_id`** (NOT a request header — the BFF chat director forwards no session header).

The Phase-3 substrate splits cleanly into **reuse-verbatim** pieces (`web/src/lib/sse.ts` `openSseStream` with its `onOpen` header hook + abort; `web/src/features/flow/timeline/connection.ts` the connection machine; `web/src/test/mocks/fetch-event-source.ts` the controllable fake emitter) and **flow-specific** pieces that chat must NOT reuse (`useRunStream`, the `timelineReducer`, the flowd schemas — all carry flowd's runId/replay/`(kind,node,ordinal)` de-dup that chat has no analogue for). The recommendation is a chat-specific `useChatStream` hook feeding a pure `turnsReducer`, structurally mirroring `useRunStream`+`timelineReducer` but over the `{kind, answer, error}` envelope — NOT a wrapper around `useRunStream`.

**Primary recommendation:** Reuse `openSseStream` + `connection.ts` + the fake-emitter test harness verbatim. Write `web/src/features/chat/` mirroring `web/src/features/flow/` layout: a `useChatStream` imperative hook + a pure `turnsReducer` over the verified `step`/`done`/`error` envelope, an `onOpen`-reads-`X-Session-Id` session seam (mirroring the Phase-3 `makeOnOpen` X-Run-ID pattern), and both send paths (stream + sync) folding into one assistant-bubble surface. No new npm runtime dependency (`@microsoft/fetch-event-source` 2.0.1 already installed). Optionally add the shadcn `switch` block, or use a segmented `button` group (no new block) for the sync/stream toggle.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Stream open / abort / header read (`X-Session-Id`) | Browser (SPA, `lib/sse.ts`) | BFF (pass-through proxy) | The console drives SSE-over-POST imperatively in the browser; the Go BFF is a transparent reverse proxy that passes the response header through untouched. |
| Frame → render model (turn/step reducer) | Browser (pure reducer) | — | Pure `(state, action)→state` fold of the SSE log; no I/O, deterministic, testable without a live backend (mirrors Phase-3 `timelineReducer`). |
| Connection-state (streaming/closed/errored) | Browser (`connection.ts`, reused) | — | Transport-only typed-union machine; Stop maps to the existing `terminal` event so it lands `closed`, never `errored`. |
| Session id assignment | API (customer-support) | — | The server assigns a UUID when the request omits `session_id`; the console only displays + echoes it. The console MUST NOT generate session ids client-side. |
| Auth injection | BFF (none for chat) | — | Chat is auth-none, IP rate-limited. The chat director strips inbound `Authorization` and forwards no bearer/scope. The console sends no auth. |
| Rate-limit enforcement | API (customer-support `limits.Guard`) | — | IP-based preflight; surfaces as HTTP 429 before any SSE frame → a send-transport failure (toast), not an in-stream `error` frame. |
| Send-failure (non-2xx before any frame) | Browser (toast via Phase-1 formula) | API (status + flat `{error}` body) | A non-2xx open (e.g. 429) is caught by `openSseStream`'s onOpen validation / the sync fetch; surfaced as a toast, composer re-enables. |

## The Verified Chat Contract

> **All of the following was read directly from source** — `../llm-agent-customer-support/internal/httpapi/httpapi.go` (the handlers + `writeSSE` + DTOs), `../llm-agent-customer-support/internal/limits/limits.go` (rate-limit status), and `../llm-agent-contract/agents/agent.go` (the `StepKind` enum + `StepEvent`/`Step`/`Result` structs). This is the planner's lock source. The BFF chat director (`internal/proxy/chat.go`) and the no-strip behaviour of `internal/proxy/memory.go` were also read directly.

### Routes + methods (all upstream paths; console calls them under `/api/chat/*`)
`[VERIFIED: ../llm-agent-customer-support/internal/httpapi/httpapi.go:52-66]`

| Console path | Upstream path | Method | Content-Type | Purpose |
|--------------|---------------|--------|--------------|---------|
| `POST /api/chat/chat` | `POST /chat` | POST | `application/json` | Synchronous one-shot (CHAT-03) |
| `POST /api/chat/chat/stream` | `POST /chat/stream` | POST | `application/json` → `text/event-stream` | Streamed agent steps (CHAT-01) |
| `GET /api/chat/healthz` | `GET /healthz` | GET | json | Liveness (not used by this phase's UI) |
| `GET /api/chat/readyz` | `GET /readyz` | GET | json | Readiness (not used by this phase's UI) |

> **Path note for the planner:** the BFF mounts the chat director at `/api/chat/` and **strips the `/api/chat` prefix** (`router.go:37` `http.StripPrefix("/api/chat", proxy.NewChatProxy(cfg))`). So upstream `POST /chat/stream` is reached from the browser at **`POST /api/chat/chat/stream`** (the literal `/chat` segment is the upstream route, the `/api/chat` is the BFF mount). Define a `CHAT_BASE = '/api/chat'` constant and build `${CHAT_BASE}/chat` and `${CHAT_BASE}/chat/stream` — mirroring how `web/src/features/flow/api/stream.ts` uses `FLOW_BASE`. `[VERIFIED: internal/router/router.go:37]`

### Request DTO (both endpoints)
`[VERIFIED: httpapi.go:31-34]`
```go
type ChatRequest struct {
	Message   string `json:"message"`
	SessionID string `json:"session_id,omitempty"`
}
```
- `message` — required; a request with an empty/whitespace-only `message` returns **400** `{"error":"message is required"}`. `[VERIFIED: httpapi.go:235-237]`
- `session_id` — optional; **omit on the first turn** (server assigns one), **send the prior id on every subsequent turn** (CHAT-02). This is the ONLY session mechanic — it travels in the request **body**, never a header.

### Sync response DTO (`POST /chat`)
`[VERIFIED: httpapi.go:36-40,143-147]`
```go
type ChatResponse struct {
	Answer    string `json:"answer"`
	Agent     string `json:"agent"`
	SessionID string `json:"session_id,omitempty"`
}
```
- The sync reply carries the final `answer`, the `agent` name, and `session_id`. It ALSO sets the `X-Session-Id` response header (`httpapi.go:258`). The console may read the id from either; the body field is the more robust source for the sync path.
- The sync path returns **no step trace** — only the final answer (the trace exists in `Result.Trace` server-side but is NOT serialized to the sync response). So a sync turn's bubble shows the answer directly, no "{N} steps" summary (D-03 / UI-SPEC IC-3).

### Streamed frame schema (`POST /chat/stream`, the `writeSSE` path)
`[VERIFIED: httpapi.go:46-50,183-201,287-291]`

Every frame is an SSE **named event** whose `data:` line is a JSON `StreamEnvelope`:
```go
type StreamEnvelope struct {
	Kind   string `json:"kind"`
	Answer string `json:"answer,omitempty"`
	Error  string `json:"error,omitempty"`
}
```
The wire framing is exactly (note: `\n\n` frame terminator, `event:` then `data:`):
```
event: step
data: {"kind":"thought","answer":"Looking up the order status…"}

event: done
data: {"kind":"done","answer":"Your order ships tomorrow."}
```

| SSE event | When emitted | `kind` value | `answer` | `error` | Terminal? |
|-----------|--------------|--------------|----------|---------|-----------|
| `step` | each intermediate agent step (`ev.Done == false`) | the agent `StepKind` (see enum below) | **the step's text content** (`ev.Step.Content`) | — | No |
| `done` | terminal success (`ev.Done && ev.Final != nil`) | `"done"` | **the final answer** (`ev.Final.Answer`) | — | **Yes** |
| `done` | terminal with no final result (`ev.Done && ev.Final == nil && ev.Err == nil`) | `"done"` | empty | — | **Yes** (edge case — a `done` with no answer) |
| `error` | terminal failure (`ev.Done && ev.Err != nil`) | `"error"` | — | **the failure string** (`ev.Err.Error()`) | **Yes** |

> **CRITICAL contract detail #1 — step content lives in `answer`, not a `content` field.** For a `step` frame the server writes `StreamEnvelope{Kind: string(ev.Step.Kind), Answer: ev.Step.Content}` (`httpapi.go:196-199`). So **the step's text is in `data.answer`** for both `step` and `done` frames. The reducer reads `answer` for both; the `kind` field disambiguates a step (slate trace row) from the terminal answer (the collapsed bubble answer). `[VERIFIED: httpapi.go:196-199]`

> **CRITICAL contract detail #2 — `Step.Tool`/`Args`/`Result` are NOT in the SSE frame.** The agent `Step` struct has `Tool`, `Args`, `Result` fields (`agent.go:56-62`), but the streaming handler only serializes `Kind` + `Content` (as `answer`). So an `action` step's tool name / a `observation` step's result text are NOT separately available over SSE — they are folded into `Content`/`answer` by the agent. The chat trace row renders `kind` (icon+label) + `answer` (the content text). Do not plan UI that expects a separate tool/args field per step — it isn't on the wire. `[VERIFIED: httpapi.go:196-199 + agent.go:56-62]`

> **CRITICAL contract detail #3 — there is exactly one terminal frame, then the stream closes.** After writing the terminal `done`/`error` the handler `flush()`es and `return`s (`httpapi.go:192-193`), closing the stream. There is no `flow_started`-style opening frame and no per-frame `seq`/`id`/`ts`. The first frame the client sees may be a `step` or directly a terminal frame. `[VERIFIED: httpapi.go:183-201]`

#### The agent `StepKind` enum (the `step.kind` values)
`[VERIFIED: ../llm-agent-contract/agents/agent.go:64-73]`
```go
type StepKind string
const (
	StepThought     StepKind = "thought"
	StepAction      StepKind = "action"
	StepObservation StepKind = "observation"
	StepReflection  StepKind = "reflection"
	StepPlan        StepKind = "plan"
	StepFinal       StepKind = "final"
)
```
Six step kinds. The UI-SPEC maps each to a neutral-slate icon (`--status-unknown`); only the two terminal events `done` (green) / `error` (red) carry status color. **`kind` is a Go `string`** — parse it loosely (any unknown future kind → neutral `circle` fallback, never crash) exactly as the Phase-3 reducer treats `.loose()` payloads. `[VERIFIED: agent.go:65 — `type StepKind string`]`

### Session id mechanic (CHAT-02) — fully resolved
`[VERIFIED: httpapi.go:20,132,141,168,241-260 + ../llm-agent-customer-support/internal/httpapi/httpapi_test.go:83-131 + internal/proxy/chat.go:13-15]`

- The server header constant is `const sessionHeader = "X-Session-Id"` (`httpapi.go:20`).
- **On `/chat/stream`:** `handleStream` calls `withRequestSession(w, ctx, req.SessionID)` at line 168 — which, if `session_id` is empty, generates `uuid.NewString()` and **sets `w.Header().Set("X-Session-Id", id)` BEFORE `w.WriteHeader(200)`** (line 181). **So `X-Session-Id` is present on the open response, readable by `onOpen(response)` before any frame flows** — exactly the seam the Phase-3 `onOpen` X-Run-ID pattern uses. `[VERIFIED: httpapi.go:168,178-181,241-247]`
- **On `/chat`:** `handleChat` calls `ensureSessionID` (line 141) which sets the same `X-Session-Id` header AND returns it in the `session_id` body field (lines 143-147). `[VERIFIED: httpapi.go:141-147,250-260]`
- **Reuse on the next turn:** send the captured id back as the request **body** field `session_id`. The server test `TestChatHandler_ThreadsProvidedSessionIDIntoContext` confirms a request `{"message":"hi","session_id":"sess-123"}` echoes `X-Session-Id: sess-123`. `[VERIFIED: httpapi_test.go:83-104]`
- **The BFF does NOT carry session via a header.** `internal/proxy/chat.go:13-15` documents: "Session continuity for chat works via the request body (session_id field), not via a request header — the chat service sets X-Session-Id in its RESPONSE only … Phase 1's chat director forwards no session header." The chat director also calls `delConsoleHeaders(r.Out.Header)` on the OUTBOUND request, stripping any `X-Console-*`/`X-Session-Id` the browser might set — so the console MUST put the session id in the JSON body, not a header. `[VERIFIED: internal/proxy/chat.go:23-29 + internal/proxy/memory.go:34-44,60-64]`
- **The BFF does NOT strip `X-Session-Id` from the chat RESPONSE.** `sseBufferingDefense` (the chat director's `ModifyResponse`) only touches `X-Accel-Buffering`/`Cache-Control`; `delConsoleHeaders` only runs on the request. So the response `X-Session-Id` reaches the browser intact through the proxy for both endpoints. `[VERIFIED: internal/proxy/memory.go:60-77 + internal/proxy/chat.go:20-30]`

### Auth posture (confirm: chat is auth-none)
`[VERIFIED: internal/proxy/chat.go:9-30 + ../llm-agent-customer-support/internal/limits/limits.go]`

- Chat is **auth-none, IP rate-limited.** The customer-support service has no auth middleware on `/chat` / `/chat/stream`; access control is `limits.Guard.Preflight` keyed on `r.RemoteAddr` (`httpapi.go:262-275`).
- The BFF chat director **injects nothing**: `r.Out.Header.Del("Authorization")` (strips any inbound bearer) and `delConsoleHeaders(r.Out.Header)` (strips `X-Console-*` scope). No bearer, no scope, no tenant.
- **The console MUST NOT send:** any `Authorization` header, any `X-Console-*` scope header, any `X-Tenant-Id`/`X-User-Id`/`X-Session-Id` request header. The chat fetchers send **only** `Content-Type: application/json` + the JSON body — exactly like the Phase-3 flow stream wrappers send only `Content-Type` (they too inject no auth; `web/src/features/flow/api/stream.ts:7-9`). There is **no MEM-08-style context gate** for chat. `[VERIFIED: internal/proxy/chat.go + web/src/features/flow/api/stream.ts:7-9]`

### Rate-limit / error status mapping (the send-failure surface)
`[VERIFIED: ../llm-agent-customer-support/internal/limits/limits.go:82-133,115 + httpapi.go:133-138,169-174,283-285]`

- `limits.Guard.Preflight` runs **before** `agent.Run`/`agent.RunStream` and before any SSE header is written. On a limit hit it returns **429** with a flat `{"error":"<reason>"}` body — reasons: `"rate limit exceeded"`, `"request exceeds max tokens per request"`, `"daily token budget exceeded"`, `"tool loop limit exceeded"`, `"retry attempts limit exceeded"`. `[VERIFIED: limits.go:82-133]`
- A bad request (non-JSON / empty message) → **400** flat `{"error":...}`. `[VERIFIED: httpapi.go:126-130,283-285]`
- The customer-support error envelope is **flat `{"error":"string"}`** (`ErrorResponse`, `httpapi.go:42-44`) — same shape as the flowd flat envelope, NOT the memory gateway's nested `{error:{code,message,...}}`. Reuse the Phase-3 flat-envelope parsing approach (a chat-specific `parseChatError`), **NOT** Phase-2's `parseGatewayError`. `[VERIFIED: httpapi.go:42-44]`
- **Where each error surfaces (the planner's split):**
  - **429 / 400 / any non-2xx BEFORE the stream opens** → there is no `text/event-stream` body, so `openSseStream`'s onOpen content-type validation throws (or the sync fetch sees a non-2xx) → **send-failure TOAST** (Phase-1 formula `Send failed — {status}: {error}.`), composer re-enables. (UI-SPEC: send/transport failure row.)
  - **An `error` SSE frame mid-stream** (the agent failed after the stream opened) → renders **in-bubble red** "Failed — {error}.", connection badge → **closed** (a clean stream end with an error result). NOT a toast.

## Reuse-vs-Adapt: the Phase-3 SSE substrate (the planner's structural call)

> Read directly from the executed code: `web/src/lib/sse.ts`, `web/src/features/flow/timeline/{connection.ts,useRunStream.ts,reducer.ts}`, `web/src/test/mocks/fetch-event-source.ts`, `web/src/features/flow/api/stream.ts`.

### Reuse VERBATIM (import / mock as-is — do not copy, do not modify)

| Asset | Path | Why it reuses unchanged |
|-------|------|-------------------------|
| `openSseStream` | `web/src/lib/sse.ts` | Frame-schema-agnostic SSE-over-POST wrapper. Its `onOpen(response)` hook reads response headers (the chat session seam reads `X-Session-Id` exactly as flow reads `X-Run-ID`); it re-applies fetch-event-source's open validation AFTER `onOpen` so a non-2xx open (429) is NOT swallowed (this IS the send-failure detection for chat). Forwards `{event, data}` raw. Already comments "inherited by … Phase 4 chat SSE." `[VERIFIED: web/src/lib/sse.ts:6-9]` |
| `connection.ts` machine | `web/src/features/flow/timeline/connection.ts` | Fully generic — `ConnState`/`ConnEvent` carry NO flow types. Stop maps to `{type:'terminal'}` → `closed` (the operator-initiated clean close, D-05/IC-5). The terminal-then-error guard (line 42) means a late abort fallout after Stop stays `closed`, never flips to `errored`. Extensible for Phase-5 `reconnecting`. **Import from the shared location, or relocate to `web/src/lib/connection.ts` if the planner wants it out of the `flow/` namespace** (a pure file move; recommendation: leave it where it is and import cross-feature, or move to `lib/` — either is fine, no logic change). `[VERIFIED: connection.ts:12-46]` |
| Fake SSE emitter | `web/src/test/mocks/fetch-event-source.ts` | The `makeFakeSseStream()` emitter + the `frames()` helper are frame-schema-agnostic. `emitOpen(headers)` delivers arbitrary open headers (chat scripts `{'X-Session-Id':'sess-1'}`), `emit(frames([...]))` scripts `step`/`done`/`error`, `close()`/`fail()` model clean-close vs transport-drop. The flow golden sequences stay flow-specific; chat adds its own golden sequences using the same `frames()` helper. `[VERIFIED: test/mocks/fetch-event-source.ts:30-35,116-182]` |
| `@microsoft/fetch-event-source` 2.0.1 | `web/package.json` dependency | Already installed since Phase 1/3. **No new runtime dependency this phase.** `[VERIFIED: web/package.json:15]` |

### Do NOT reuse (flow-specific — write chat equivalents)

| Flow asset | Why chat needs its own | Chat equivalent |
|------------|------------------------|-----------------|
| `useRunStream` (`timeline/useRunStream.ts`) | Carries flowd's `runId` (X-Run-ID), `replay(runId)`, `retry()` via `GET /runs/{id}/events` history-hydration, and the `lastStartRef` re-open logic — chat has **none** of these (no run id, no replay endpoint, no events-list endpoint; the session id is the only id and it is NOT a run id). | **`useChatStream`** — a new imperative hook mirroring the STRUCTURE (AbortController ref, dispatch-on-frame, abort-on-terminal, abort-on-unmount) but over the chat envelope, with a session-id seam instead of a run-id seam. |
| `timelineReducer` (`timeline/reducer.ts`) | The whole reducer is the `(kind, node, ordinal)` per-source de-dup machine for the **late-join/replay overlap** problem (history prefix + live tail merge). Chat has **no replay and no history source** → no de-dup problem at all. The flow node-status map (`node_started`→running etc.) has no chat analogue. | **`turnsReducer`** — a much simpler pure reducer: a list of turns; the active assistant turn accumulates `step` rows (append-only, no de-dup), sets `finalAnswer` on `done`, `error` on `error`. No `seen`/`ordinals`/`nodeStatus`. |
| flow schemas (`flow/api/schemas.ts`) | flowd's 6-kind `sseKindEnum` + `ssePayloadSchema` + flow/run DTOs are flowd-specific. | **`chat/api/schemas.ts`** — a tiny `chatRequestSchema`, `chatResponseSchema` (`{answer, agent, session_id}`), and a loose `streamEnvelopeSchema` (`{kind, answer?, error?}`, `.loose()`); a flat `chatErrorSchema` `{error:string}`. |
| `runStream`/`replayStream` (`flow/api/stream.ts`) | flow-route + X-Run-ID specific. | **`chat/api/stream.ts`** — a `chatStream(message, sessionId, handlers, signal)` calling `openSseStream({url: '/api/chat/chat/stream', body: JSON.stringify({message, session_id})})` with a `makeOnOpen` that reads `X-Session-Id` (mirror of `flow/api/stream.ts:32-42`); and a `chatSync(message, sessionId)` plain `fetch` (POST `/api/chat/chat`) returning the parsed `{answer, agent, session_id}`. |

### Recommended structure (mirrors `web/src/features/flow/`)
```
web/src/features/chat/
├── api/
│   ├── client.ts          # CHAT_BASE='/api/chat'; chatSync(); parseChatError() (flat {error})
│   ├── stream.ts          # chatStream() over openSseStream + makeOnOpen reading X-Session-Id
│   └── schemas.ts         # chatRequest/Response + loose streamEnvelope + flat chatError (zod)
├── turns/
│   ├── reducer.ts         # pure turnsReducer (append steps, set finalAnswer/error)
│   ├── useChatStream.ts   # imperative hook: send(message, sessionId), stop(), abort-on-unmount
│   └── *.test.ts          # reducer + hook tests using the fake emitter
├── ChatPage.tsx           # the /chat route surface (header + transcript + composer)
└── components/            # SessionHeader, MessageBubble, StepTrace, Composer, ConnectionBadge(reuse)
```
> **Why a chat-specific hook+reducer and NOT a `useRunStream` wrapper:** wrapping `useRunStream` would drag in runId/replay/retry/de-dup state that is dead weight for chat and would force chat frames through the flow `(kind,node,ordinal)` keying that has no meaning here. A parallel `useChatStream`+`turnsReducer` is *less* code than the adapter glue and keeps each feature's contract honest. This is the validated generalization the CONTEXT calls out: the **pattern** (imperative stream → pure reducer + `connection.ts`) reuses; the **schema-bound** pieces are per-feature.

## Standard Stack

No new packages. The entire phase is built on the already-installed stack.

### Core (all already present — verified in `web/package.json`)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@microsoft/fetch-event-source` | 2.0.1 | SSE-over-POST (already wrapped by `lib/sse.ts`) | Both stream endpoints are POST; native EventSource is GET-only. Reused, not re-added. `[VERIFIED: web/package.json:15]` |
| `react` / `react-dom` | 19.2.x | UI | Project standard. `[CITED: PROJECT.md stack table]` |
| `@tanstack/react-router` | 1.170.11 | The `/chat` route | Replaces the existing `ChatPlaceholder` route (`web/src/app/routes/chat.tsx`). `[VERIFIED: web/package.json:18]` |
| `zod` | 4.4.x | Loose runtime narrowing of the `{kind,answer,error}` envelope + flat `{error}` | Mirror the Phase-3 `.loose()` posture. `[CITED: PROJECT.md stack table]` |
| shadcn/ui blocks | CLI 3.x | bubbles/composer/trace chrome | All needed blocks already installed (see below). `[VERIFIED: web/src/components/ui/]` |

### Supporting (installed shadcn blocks this phase uses — verified present)
`button, card, badge, textarea, collapsible, scroll-area, tooltip, separator, sonner` — all present in `web/src/components/ui/`. `[VERIFIED: ls web/src/components/ui/]`

> **TanStack Query is essentially unused this phase** (IC-6): streams are imperative; the sync path is a one-shot local-state fetch with no caching/dedupe/invalidation need. Do NOT route chat through Query.

### The one optional addition
| Need | Option A (no new block) | Option B (new block) |
|------|--------------------------|----------------------|
| Sync/stream toggle | A 2-segment `button` group labelled `Stream \| Sync` (recommended — no new registry block; `button` already installed). | `npx shadcn add switch` (official registry, no vetting gate). `switch` is NOT currently installed. `[VERIFIED: web/src/components/ui/ has no switch.tsx]` |

## Package Legitimacy Audit

> **Not applicable — this phase installs no external packages.** The only runtime dependency (`@microsoft/fetch-event-source` 2.0.1) is already installed and was legitimacy-audited in Phase 1/3 (PROJECT.md notes it was republished 2026-04-23 and is actively maintained). The optional `shadcn add switch` copies source into the repo from the official shadcn registry (no npm runtime dependency, no vetting gate). No `npm install` of any new package is required.

## Architecture Patterns

### System Architecture Diagram
```
┌──────────────────────────── Browser (SPA) ─────────────────────────────┐
│                                                                          │
│  Composer ──send(message)──▶ useChatStream.send()                        │
│   (textarea,                    │                                        │
│    Enter-sends,         ┌───────┴────────┐                               │
│    Stop)                │ mode == stream? │                               │
│                         └───┬─────────┬──┘                               │
│                       stream│         │sync                              │
│                             ▼         ▼                                  │
│              chatStream(msg,sid)   chatSync(msg,sid)                     │
│              = openSseStream(POST  = fetch(POST /api/chat/chat)          │
│                /api/chat/chat/stream)        │                           │
│                  │  onOpen(resp)──read X-Session-Id──▶ setSessionId      │
│                  │                           │ (also session_id in body) │
│         ┌────────┴─────────┐                 │                           │
│         │ onMessage(frame) │                 │                           │
│         ▼                  ▼                 ▼                           │
│   event:step          event:done/error   {answer,agent,session_id}      │
│   {kind,answer}       {kind,answer/error}    │                           │
│         │                  │                 │                           │
│         ▼                  ▼                 ▼                           │
│   turnsReducer: append step row │ set finalAnswer │ set error            │
│         │                                                                 │
│         ├──▶ connection.ts: start→streaming; terminal/Stop→closed;       │
│         │                   transport-drop→errored                       │
│         ▼                                                                 │
│   ChatPage transcript: [USER bubble] [ASSISTANT bubble:                  │
│       collapsible step trace (Phase-3 frame-row renderer) + answer       │
│       + ConnectionBadge + Stopped/Failed marker]                         │
│                                                                          │
│   Stop ──▶ AbortController.abort() ──▶ connection terminal (closed),     │
│            partial steps/answer STAY, "Stopped" chip                     │
└──────────────────────────────────────────────────────────────────────────┘
                              │ same-origin
                              ▼
        Go BFF (httputil.ReverseProxy) — /api/chat/* → StripPrefix → customer-support
          • strips Authorization + X-Console-* on the request (chat = auth-none)
          • passes X-Session-Id RESPONSE header through untouched
          • ModifyResponse sets X-Accel-Buffering:no on text/event-stream
                              │
                              ▼
        customer-support :  POST /chat (sync)  ·  POST /chat/stream (SSE)
          • assigns session_id (UUID) when body omits it; echoes X-Session-Id
          • limits.Guard preflight (IP rate-limit) → 429 BEFORE any frame
          • RunStream → step* → done|error (one terminal frame, then close)
```

### Pattern 1: `onOpen`-reads-`X-Session-Id` (mirror of the Phase-3 X-Run-ID seam)
**What:** Read the server-assigned session id from the open response header before frames flow, fire a callback once.
**When to use:** the chat stream path's session capture (CHAT-02).
**Example (the chat mirror of the verified flow pattern):**
```typescript
// Mirror of web/src/features/flow/api/stream.ts:32-42 (makeOnOpen) —
// reads X-Session-Id instead of X-Run-ID.
function makeOnSession(onSession?: (id: string) => void) {
  let fired = false
  return (response: Response) => {
    if (fired) return
    const sid = response.headers.get('X-Session-Id')   // [VERIFIED: header set pre-WriteHeader, httpapi.go:181]
    if (sid) { fired = true; onSession?.(sid) }
  }
}
// chatStream passes onOpen: makeOnSession(handlers.onSession) into openSseStream.
```

### Pattern 2: pure `turnsReducer` over the verified envelope
**What:** Fold the `step`/`done`/`error` SSE log into a list of turns; the active assistant turn accumulates steps then settles to a final answer or error.
**When to use:** the keystone render contract (D-01).
**Example (the shape — no de-dup, far simpler than `timelineReducer`):**
```typescript
type StepRow = { kind: string; text: string }          // text = data.answer (step content)
type AssistantTurn = {
  steps: StepRow[]
  finalAnswer?: string                                   // from done.answer
  error?: string                                         // from error.error
  status: 'streaming' | 'done' | 'error' | 'stopped'
}
// action 'frame' (kind, payload): kind==='done' -> finalAnswer=payload.answer, status='done'
//                                 kind==='error'-> error=payload.error,        status='error'
//                                 else (a step) -> steps.push({kind, text: payload.answer})
// action 'stop' -> status='stopped' (partial steps/answer STAY)  [D-05]
```
> Parse the envelope loosely (`.loose()` zod or a try/catch JSON.parse like `useRunStream.onFrame` `web/src/features/flow/timeline/useRunStream.ts:78-83`) so a malformed/unknown-kind frame is dropped/neutralised, never crashes the transcript.

### Pattern 3: one assistant bubble for stream AND sync (D-03 / IC-3)
**What:** Both send paths write into the same active `AssistantTurn`. The stream path fills `steps` live + `finalAnswer` on `done`; the sync path sets `finalAnswer` directly (empty `steps`).
**When to use:** the sync fallback (CHAT-03) must reuse the streamed bubble surface, not a second surface.

### Anti-Patterns to Avoid
- **Generating the session id client-side.** The server owns id assignment (`uuid.NewString()` when the body omits `session_id`). The console reads it from the response and echoes it; it never mints one. `[VERIFIED: httpapi.go:243-245]`
- **Sending the session id as a request header.** The BFF strips `X-Console-*`/`X-Session-Id` on the outbound request; the only honored channel is the body field `session_id`. `[VERIFIED: internal/proxy/chat.go + memory.go:34-44]`
- **Sending any auth/scope.** Chat is auth-none; sending `Authorization`/`X-Console-*` is at best stripped, at worst confusing. Send only `Content-Type: application/json` + body.
- **Reusing `parseGatewayError` (the nested envelope).** Chat errors are flat `{error}` — use a chat-specific flat parser.
- **Wrapping `useRunStream`.** Drags in runId/replay/retry/de-dup dead weight. Write `useChatStream`.
- **Expecting a separate tool/args/result field per step.** Only `kind` + `answer` (content) are on the wire; tool detail is folded into the content by the agent.
- **Treating a 429 as an in-bubble error.** A 429 fires before any frame → it's a send-failure toast, composer re-enables. An in-bubble red "Failed" is reserved for the `error` SSE frame.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE-over-POST framing/parse | A hand-rolled `fetch`+`ReadableStream` SSE parser | `openSseStream` (`lib/sse.ts`) — already wraps `@microsoft/fetch-event-source` | Event/data framing, the open-validation guard, abort, and onOpen header access are already solved + tested. |
| Connection state machine | A boolean `isStreaming`/`isError` | `connection.ts` (`connReducer`) | The typed union + terminal-then-error guard prevents a late abort/onError after Stop from flipping `closed`→`errored` (the D-05 operator-critical bug). Extensible for Phase-5 reconnect. |
| Deterministic stream tests | A real backend / timers / network mocks | `makeFakeSseStream()` + `frames()` (`test/mocks/fetch-event-source.ts`) | Scripts `step`/`done`/`error`, delivers `X-Session-Id` via `emitOpen`, models clean-close vs drop — the whole keystone is provable without a live customer-support. |
| Stopping a stream | A flag the reducer checks | `AbortController.abort()` (the Phase-3 abort seam) | Aborting the fetch propagates a client disconnect so customer-support's `r.Context()` cancels and the agent stops running detached (`httpapi.go` exits on ctx cancel; `httpapi_test.go:261` pins this). `[VERIFIED: httpapi_test.go:261-280]` |

**Key insight:** the entire streaming substrate this phase needs already exists, is tested, and was explicitly designed (its own comments say so) to be inherited by Phase 4 chat. The phase's real work is the small chat-specific reducer + the bubble/trace/composer UI — not any streaming primitive.

## Common Pitfalls

### Pitfall 1: Putting `session_id` in a request header instead of the body
**What goes wrong:** Session continuity silently breaks — every turn gets a fresh server-assigned id, the header never updates, the transcript looks continuous but the backend sees independent sessions.
**Why it happens:** The response carries `X-Session-Id` as a header, so it's tempting to echo it as a header. But the BFF strips client `X-Session-Id`/`X-Console-*` on the outbound request, and the upstream only reads `session_id` from the JSON body.
**How to avoid:** Capture the id from the response (header on stream open; body on sync), store it, and send it back in the **request body** `session_id` on the next turn. `[VERIFIED: internal/proxy/chat.go:13-15]`
**Warning signs:** the `X-Session-Id` returned on turn 2 differs from turn 1.

### Pitfall 2: Reading step content from a `content` field that isn't on the wire
**What goes wrong:** Step rows render blank.
**Why it happens:** The Go `Step` struct has a `Content` field, but the SSE frame serializes it into **`answer`** (`Answer: ev.Step.Content`). There is no `content` JSON key.
**How to avoid:** Read step text from `data.answer` for BOTH `step` and `done` frames; use `kind` to tell them apart. `[VERIFIED: httpapi.go:196-199]`

### Pitfall 3: Conflating a 429 (send-failure) with an `error` frame (turn failure)
**What goes wrong:** Either a rate-limit shows as a red in-bubble "Failed" with no way to retry the send, or an agent failure shows only as a toast and the partial trace is lost.
**Why it happens:** Both are "errors" but they arrive on different channels — a 429 is a non-2xx open (no SSE body), an `error` frame is an in-stream terminal.
**How to avoid:** non-2xx open (onOpen validation throws / sync non-2xx) → **toast**, composer re-enables. In-stream `error` frame → **in-bubble red**, partial trace stays, connection→closed. `[VERIFIED: httpapi.go:133-138,169-174,186 vs limits.go:82-133]`

### Pitfall 4: Stop flipping the connection to `errored` (the D-05 operator-critical bug)
**What goes wrong:** Aborting the fetch fires fetch-event-source's `onError`/promise rejection; if that routes to `{type:'transport-error'}`, the connection goes amber "Connection lost" — making the operator think the pipe died, when they stopped it.
**Why it happens:** Stop aborts the fetch, which surfaces as an error to the SSE client.
**How to avoid:** On Stop, dispatch the connection machine's `{type:'terminal'}` (→ `closed`, neutral) BEFORE/instead of letting the abort-induced error reach `transport-error`. The `connection.ts` terminal-then-error guard (line 42) then keeps it `closed` even if a late onError arrives. This is the single most important visual contract in the phase. `[VERIFIED: connection.ts:40-42 + useRunStream.ts:118-121 (the abort-then-ignore-rejection pattern to mirror)]`

### Pitfall 5: Forgetting the bare-`done`-with-no-answer edge case
**What goes wrong:** A `done` frame with empty `answer` (the `ev.Final == nil` branch, `httpapi.go:190`) leaves the bubble blank with no answer and no error.
**Why it happens:** The handler can emit `event:done {"kind":"done"}` with no `answer` when the agent produced no final result.
**How to avoid:** On a `done` with empty `answer`, still settle the turn to `done` (collapse the trace) and render a muted "(no answer returned)" rather than a blank bubble. `[VERIFIED: httpapi.go:189-191]`

### Pitfall 6: Re-running the stream parser through TanStack Query
**What goes wrong:** Cache churn, stale frames, lost order.
**Why it happens:** Query is the project's default for REST.
**How to avoid:** streams are imperative (IC-6); only the (optional) sync one-shot is a fetch, and even that uses local turn state, not Query. `[CITED: 04-UI-SPEC IC-6 + PROJECT.md SSE section]`

## Code Examples

### Sending a streamed turn (the verified request + reuse of `openSseStream`)
```typescript
// chat/api/stream.ts — mirrors web/src/features/flow/api/stream.ts:46-66
import { openSseStream } from '@/lib/sse'
const CHAT_BASE = '/api/chat'                 // BFF mount; StripPrefix removes it [VERIFIED: router.go:37]

export function chatStream(
  message: string,
  sessionId: string | undefined,            // omit on first turn; echo prior id after
  handlers: { onMessage: (f:{event?:string;data:string})=>void
              onSession?: (id:string)=>void
              onError?: (e:unknown)=>void },
  signal?: AbortSignal,
): Promise<void> {
  return openSseStream({
    url: `${CHAT_BASE}/chat/stream`,          // → upstream POST /chat/stream [VERIFIED: httpapi.go:57]
    method: 'POST',
    body: JSON.stringify({ message, session_id: sessionId }), // session_id in BODY [VERIFIED: httpapi.go:31-34]
    signal,
    onOpen: makeOnSession(handlers.onSession),                // reads X-Session-Id [VERIFIED: httpapi.go:181]
    onMessage: handlers.onMessage,
    onError: handlers.onError,
  })
}
```

### The sync one-shot (CHAT-03)
```typescript
// chat/api/client.ts
export async function chatSync(message: string, sessionId?: string) {
  const res = await fetch(`${CHAT_BASE}/chat`, {            // → upstream POST /chat [VERIFIED: httpapi.go:54]
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },         // no auth, no scope [VERIFIED: chat.go:25-26]
    body: JSON.stringify({ message, session_id: sessionId }),
  })
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: res.statusText }))
    throw new ChatError(res.status, error)                   // flat {error} [VERIFIED: httpapi.go:42-44]
  }
  return (await res.json()) as { answer: string; agent: string; session_id?: string } // [VERIFIED: httpapi.go:36-40]
}
```

### Stop without flipping to errored (Pitfall 4)
```typescript
// in useChatStream:
const stop = useCallback(() => {
  dispatch({ type: 'stop' })            // partial steps/answer STAY, status='stopped' (D-05)
  dispatchConn({ type: 'terminal' })    // → 'closed' (neutral), NOT transport-error [VERIFIED: connection.ts:38-39]
  abortRef.current?.abort()             // cancels upstream r.Context() [VERIFIED: httpapi_test.go:261]
  abortRef.current = null
}, [])
// the chatStream(...).catch(()=>{}) swallows the abort-induced rejection
// (mirror useRunStream.ts:118-121) so it never reaches transport-error.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Native `EventSource` for SSE | `@microsoft/fetch-event-source` over POST | Project inception (PROJECT.md) | Both chat endpoints are POST; EventSource is GET-only. Already wrapped in `lib/sse.ts`. |
| Per-feature ad-hoc stream state | Imperative hook → pure reducer + shared `connection.ts` machine | Phase 3 (executed) | Chat is the third consumer, validating the substrate generalizes. |

**Deprecated/outdated:** nothing chat-specific. The `@microsoft/fetch-event-source` "dormant package" concern noted in PROJECT.md is resolved (republished 2026-04-23; 2.0.1 actively maintained).

## Runtime State Inventory

> Not a rename/refactor/migration phase — greenfield feature addition. This section is included only to record the (minimal) live-state touchpoints for completeness.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None** — chat has no client-side persistence store (D-06: New session clears to empty, no history store). The session_id lives only in React state; it is NOT persisted to localStorage (unlike the operator context, which deliberately excludes a chat session store). | None |
| Live service config | **None** — the BFF chat director (`internal/proxy/chat.go`) and the `/api/chat/` route (`internal/router/router.go:37`) already exist from Phase 1 and need no change. The console only adds frontend code. | None — verified the route + director are already wired. |
| OS-registered state | **None** — verified: no scheduled tasks, daemons, or OS registrations involved in a frontend chat feature. | None |
| Secrets/env vars | **None new** — chat is auth-none; the BFF injects no chat secret. `ChatBase` (`internal/config/config.go:34`) already configures the upstream URL. | None |
| Build artifacts | The `ChatPlaceholder` route (`web/src/app/routes/chat.tsx`) is REPLACED by the real `ChatPage`. No stale build artifact — `vite build` / `tsc -b` regenerate from source. | Replace the placeholder route component; no artifact cleanup needed. |

## Validation Architecture

> `workflow.nyquist_validation` is not disabled in config → included. The keystone is provable without a live backend by reusing the Phase-3 fake emitter.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 + jsdom + @testing-library/react 16.3.2 + @testing-library/jest-dom 6.6.3 `[VERIFIED: web/package.json + web/vitest.config.ts]` |
| Config file | `web/vitest.config.ts` (jsdom, globals, `setupFiles: ./src/test/setup.ts`, `include: src/**/*.test.{ts,tsx}`) `[VERIFIED]` |
| Quick run command | `cd web && npx vitest run src/features/chat` |
| Full suite command | `cd web && npm test` (`vitest run`) `[VERIFIED: web/package.json:11]` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CHAT-01 | `step` frames append trace rows in order; `done` sets final answer + collapses; `error` renders in-bubble red | unit (reducer) | `npx vitest run src/features/chat/turns/reducer.test.ts` | ❌ Wave 0 |
| CHAT-01 | streamed turn: open → steps live → done; streaming indicator while open | component | `npx vitest run src/features/chat/turns/useChatStream.test.ts` | ❌ Wave 0 |
| CHAT-01 | **Stop keeps the partial + "Stopped", connection→closed (NOT errored)** | component | `npx vitest run src/features/chat/turns/useChatStream.test.ts -t stop` | ❌ Wave 0 |
| CHAT-02 | `X-Session-Id` read on open (via `emitOpen({'X-Session-Id':'sess-1'})`); reused as body `session_id` on turn 2 | component | `npx vitest run src/features/chat/turns/useChatStream.test.ts -t session` | ❌ Wave 0 |
| CHAT-02 | "New session" clears transcript + resets id to "no session yet" | component | `npx vitest run src/features/chat/ChatPage.test.tsx -t "new session"` | ❌ Wave 0 |
| CHAT-03 | sync `/chat` reply renders into the SAME assistant bubble (no trace) | component | `npx vitest run src/features/chat/ChatPage.test.tsx -t sync` | ❌ Wave 0 |
| CHAT-01/03 | 429 send-failure → toast + composer re-enables (NOT in-bubble red) | component | `npx vitest run src/features/chat/ChatPage.test.tsx -t "send failed"` | ❌ Wave 0 |

### How to test the stream deterministically (reuse the Phase-3 harness)
```typescript
import { makeFakeSseStream, frames } from '@/test/mocks/fetch-event-source'
const fake = makeFakeSseStream()
vi.mock('@/lib/sse', () => ({ openSseStream: fake.openSseStream }))

// CHAT-02 — session id arrives on open:
await fake.emitOpen({ 'X-Session-Id': 'sess-1' })          // drives onOpen → onSession
// CHAT-01 — script verified chat frames:
fake.emit(frames([
  { kind: 'step', payload: { kind: 'thought', answer: 'Looking up the order…' } },
  { kind: 'step', payload: { kind: 'action',  answer: 'lookup_order(42)' } },
  { kind: 'done', payload: { kind: 'done',    answer: 'It ships tomorrow.' } },
]))
await fake.close()                                          // clean terminal → closed
// Stop test: instead of close(), call the hook's stop(); assert conn==='closed'
//   and status==='stopped' and the partial steps remain.
// Transport-drop test: fake.fail() → conn==='errored' (amber).
```
> **Chat golden sequences to add** (mirroring the flow goldens, using the same `frames()` helper): `goldenChatSuccess` (`step`×2 → `done`), `goldenChatError` (`step` → `error`), `goldenChatBareDone` (`done` with empty answer — Pitfall 5), `goldenChatSyncReply` (the `{answer,agent,session_id}` JSON for the sync fetch test). Keep them in `web/src/features/chat/` (chat-specific), not in the shared flow mock.

### Sampling Rate
- **Per task commit:** `cd web && npx vitest run src/features/chat`
- **Per wave merge:** `cd web && npm test` (full suite) + `cd web && npx tsc -b` (the build's typecheck) + `cd web && npm run lint`
- **Phase gate:** full suite green before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `web/src/features/chat/turns/reducer.test.ts` — covers CHAT-01 (fold step/done/error; stop keeps partial)
- [ ] `web/src/features/chat/turns/useChatStream.test.ts` — covers CHAT-01/02 (stream lifecycle, session capture+reuse, Stop→closed)
- [ ] `web/src/features/chat/ChatPage.test.tsx` — covers CHAT-02/03 (new session reset, sync-into-same-bubble, 429 toast)
- [ ] Chat golden frame sequences in `web/src/features/chat/` (reuse `frames()` from the shared mock)
- [ ] No framework install needed — Vitest + jsdom + RTL already configured (Phase 1/3).

## Security Domain

> `security_enforcement` not disabled → included. Chat is auth-none, so the security posture is about the BFF allowlist boundary, output-as-text, and not leaking.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Chat is intentionally auth-none (IP rate-limited at the service). No client auth to manage; the console sends none. `[VERIFIED: chat.go:25-26]` |
| V3 Session Management | partial | The chat `session_id` is an opaque server-assigned UUID for conversation continuity, NOT an auth session. It is not a credential — display it (CopyableId) freely; it grants no privilege. Do not store it in localStorage (D-06 ephemeral). `[VERIFIED: httpapi.go:243-245]` |
| V4 Access Control | yes (BFF) | The BFF allowlist exposes ONLY `/api/chat/*` → customer-support (`router.go:37`); no other upstream is reachable via the chat mount. The director strips inbound `Authorization` + `X-Console-*` (anti confused-deputy). `[VERIFIED: chat.go:23-29]` |
| V5 Input Validation | yes | Narrow the untrusted upstream JSON (`{kind,answer,error}` + flat `{error}`) with a loose zod schema before it reaches UI state — drop/neutralise malformed/unknown frames (mirror the Phase-3 `.loose()` + try/catch). The empty-message guard is the server's (400); the composer also disables Send on whitespace-only to avoid a doomed request. |
| V6 Cryptography | no | No crypto in this phase. (No idempotency-key/UUID minting client-side — the session id is server-assigned.) |
| V7 Output Encoding | yes | **Render ALL agent/chat/step/answer/error strings as TEXT nodes** — no `dangerouslySetInnerHTML`. React text-node rendering escapes by default; the only XSS risk would be opting out of it, which this phase explicitly forbids (D-01 / UI-SPEC). Agent output is untrusted (it may echo tool results / user content). `[CITED: 04-UI-SPEC Copywriting]` |

### Known Threat Patterns for the chat stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via rendered agent/tool output | Tampering / Elevation | Render every string (message, step content, answer, error) as a React TEXT node; never `dangerouslySetInnerHTML`. Treat agent output as untrusted. |
| Confused-deputy via client-set scope/auth on the chat hop | Elevation | The BFF strips `Authorization` + `X-Console-*` on the chat request; the console sends none. Already enforced server-side (defense even if the console misbehaves). `[VERIFIED: chat.go:23-29]` |
| Session-id treated as a credential | Spoofing | The chat `session_id` is opaque continuity, not auth — it grants no access (chat is auth-none). Spoofing a session id only joins/forks a conversation, not a privileged action. Do not log it as PII or treat it as a secret. |
| Over-broad proxy exposure | Information Disclosure | Only `/api/chat/*` is mapped to customer-support; the allowlist forbids reaching other upstreams through the chat mount. `[VERIFIED: router.go:37]` |
| Logging agent conversation content | Information Disclosure / Privacy | No PII logging beyond the operator surface — the console does not log message/answer bodies; the RawJsonViewer surfaces raw frames in the operator UI only (not to a log sink). Mirror the Phase-1 "BFF stays verbatim body pass-through, does NOT content-scan/redact" posture — and the console likewise does not persist or ship conversation content anywhere. `[CITED: STATE.md 01-03 D-01 body pass-through]` |

## Environment Availability

> Skipped for the runtime dependency probe (this is a frontend feature against an already-wired BFF route). The one relevant availability fact:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@microsoft/fetch-event-source` | the SSE client | ✓ | 2.0.1 (installed) | — |
| BFF `/api/chat/*` director + route | runtime proxying to customer-support | ✓ | wired in Phase 1 (`router.go:37`, `chat.go`) | — |
| `customer-support` service `:8080`/`ChatBase` | live chat (runtime only, not tests) | n/a for tests | — | All tests run against the fake emitter; no live service needed for the test gate. |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none — the whole phase is testable without a live backend via the Phase-3 fake emitter.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The optional shadcn `switch` block, if added, copies cleanly from the official registry with no vetting gate (segmented `button` avoids it entirely). | Standard Stack | Low — Recommendation 3 of the UI-SPEC; the segmented-button path needs no new block, so this is fully avoidable. |

**Note:** every wire-contract, session, auth, error-status, and reuse claim in this document is tagged `[VERIFIED: <file:line>]` from directly-read source — not training knowledge. The Assumptions Log is near-empty because the contract was read, not assumed.

## Open Questions (RESOLVED)

> Disposition: both are logic-neutral with planner-chosen answers already baked into the plans (connection.ts imported cross-feature from `features/flow/timeline/`; bare-`done`-no-answer copy chosen). Neither blocks planning.

1. **Should `connection.ts` move out of the `flow/` namespace?** — RESOLVED → planner kept the cross-feature import (surgical scope).
   - What we know: it is fully generic and now used by two features (flow, chat).
   - What's unclear: whether the planner prefers a cross-feature import from `features/flow/timeline/connection.ts` or a relocation to `web/src/lib/connection.ts`.
   - Recommendation: either is fine and logic-neutral. Relocating to `lib/` reads cleaner for a shared primitive, but it's a pure file-move + import-update touching the existing flow code — keep it minimal and out of scope if the planner wants a surgical phase; import cross-feature otherwise.

2. **`done`-with-no-answer copy.**
   - What we know: the bare-`done` edge case exists (Pitfall 5).
   - What's unclear: exact muted copy ("(no answer returned)" is a suggestion).
   - Recommendation: planner picks a muted string conforming to the Phase-1 copy formula; not a blocker.

## Sources

### Primary (HIGH confidence — directly-read source)
- `../llm-agent-customer-support/internal/httpapi/httpapi.go` — routes, `ChatRequest`/`ChatResponse`/`StreamEnvelope` DTOs, `writeSSE`, `handleChat`/`handleStream`, session header set-before-WriteHeader, the step→`answer` serialization.
- `../llm-agent-customer-support/internal/httpapi/httpapi_test.go` — session threading (`sess-123` echo), generate-when-missing, stream exits on request cancel.
- `../llm-agent-customer-support/internal/limits/limits.go` — 429 rate-limit reasons + `HTTPStatus` mapping (preflight-before-stream).
- `../llm-agent-contract/agents/agent.go` — `StepKind` enum (6 kinds), `StepEvent`/`Step`/`Result` structs (`Content`, `Tool`/`Args`/`Result` not on the wire).
- `internal/proxy/chat.go`, `internal/proxy/memory.go`, `internal/router/router.go`, `internal/config/config.go` — the BFF chat director (auth-strip, session-via-body, `X-Accel-Buffering`), the `/api/chat/` StripPrefix mount, no-strip of the response `X-Session-Id`.
- `web/src/lib/sse.ts`, `web/src/features/flow/timeline/{connection.ts,useRunStream.ts,reducer.ts}`, `web/src/features/flow/api/stream.ts`, `web/src/test/mocks/fetch-event-source.ts` — the reuse surface (verbatim-reuse vs flow-specific split).
- `web/package.json`, `web/vitest.config.ts`, `web/src/components/ui/`, `web/src/app/routes/chat.tsx` — installed deps/blocks, test config, the placeholder route to replace.
- `.planning/phases/04-chat-console/{04-CONTEXT.md,04-UI-SPEC.md}`, `.planning/{REQUIREMENTS.md,PROJECT.md,ROADMAP.md,STATE.md}` — phase decisions, the approved visual contract, requirements.

### Secondary (MEDIUM)
- PROJECT.md stack table (versions/rationale) — already research-locked in prior phases.

### Tertiary (LOW)
- None — no unverified web claims were needed; the contract is local source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all reuse verified present in `web/package.json` + `web/src/components/ui/`.
- Architecture / reuse-vs-adapt: HIGH — read the actual Phase-3 code; the split is unambiguous (generic `lib/sse.ts`+`connection.ts`+mock vs flow-bound `useRunStream`/`timelineReducer`/schemas).
- Wire contract (frames/session/auth/errors): HIGH — read directly from customer-support Go source + tests + the agent contract; corrected two UI-SPEC-adjacent details (step content is in `answer`; tool/args not on the wire).
- Pitfalls: HIGH — each derived from a specific verified source line.

**Research date:** 2026-06-04
**Valid until:** the customer-support chat contract or the Phase-3 substrate changes. Both are local source in the umbrella; re-verify if `httpapi.go` or `lib/sse.ts`/`connection.ts` change. Estimate 30 days for the stack, but the contract is pinned to source HEAD.
