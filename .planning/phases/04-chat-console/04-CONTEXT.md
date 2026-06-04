# Phase 4: Chat Console - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 delivers the **Chat Console** — the lightest feature slice, **reusing the Phase 3 SSE infrastructure**. An operator:
- Sends a message and watches **streamed agent steps** render incrementally with a streaming indicator and stop-on-error — CHAT-01.
- Maintains **session continuity**, reusing the session id across turns — CHAT-02.
- Uses the **synchronous `/chat` fallback** for a one-shot, reusing the same message rendering — CHAT-03.

Covers REQ **CHAT-01..03**. Talks to the **customer-support** service via the Phase-1 BFF chat director (`/api/chat/*` → customer-support; **auth: none** — IP rate-limited; the BFF injects no bearer/scope for chat).

**NOT in this phase:**
- A session-history list / switcher (no read endpoint to browse past sessions — consistent with memory sessions being deferred). v1 is single-active-session.
- Reconnect/backoff (Phase 5 / SHELL-02) — reuse the Phase-3 connection-state machine designed to extend; manual stop only.
- Any new streaming primitive — this phase CONSUMES the Phase-3 SSE client + append renderer + connection-state machine.

**Phase 3 proved the SSE substrate** (imperative `useRunStream`-style streaming, the append/timeline renderer, the connection-state machine, `@microsoft/fetch-event-source` SSE-over-POST, the abort seam). This discussion settled how chat consumes/adapts it.

</domain>

<decisions>
## Implementation Decisions

### Conversation + agent-step rendering
- **D-01:** **Chat bubbles + collapsible inline step trace.** User/assistant chat bubbles. The assistant turn streams its **agent steps** as a **collapsible inline "step trace"** — reusing the **Phase-3 append/timeline renderer** for the steps — live as they arrive, then collapses to the final answer on completion (re-expandable). A **streaming indicator** shows in the active assistant bubble while streaming; **stop-on-error** renders the error in-bubble (CHAT-01). Render all agent/chat strings as TEXT nodes (no `dangerouslySetInnerHTML`).

### Session continuity & management
- **D-02:** **Single active session + "New session".** One active chat session; its id is shown via **CopyableId** in the header and **reused across turns** (CHAT-02). A **"New session"** button starts fresh. NO session-list/history (no browse endpoint). The exact session_id mechanic (server-assigned-on-first-/chat vs client-supplied) is research-gated — see Specifics.
- **D-06:** **New session clears to a fresh empty conversation** — the view resets to empty with a new session id; the prior transcript leaves the view (no history store). One session at a time.

### Sync vs streamed
- **D-03:** **Streamed default + sync toggle, ONE assistant bubble.** Streaming (`/api/chat/stream`) is the default send path; a **toggle** (or secondary action) sends the synchronous `/api/chat` one-shot instead (CHAT-03). The sync reply renders into the **SAME assistant bubble** the stream would fill — one message surface, not two. Mirrors the Phase-3 run-trigger decision (D-04).

### Compose / input UX
- **D-04:** **Multi-line composer, Enter-sends + Stop.** Multi-line input; **Enter sends, Shift+Enter = newline**; input **disabled while a response streams**; a **Stop** button cancels the in-flight stream via the **Phase-3 abort seam** (abort the fetch).
- **D-05:** **Stop keeps the partial + "Stopped" marker.** On Stop, the partial answer/steps stay in the assistant bubble with a clear **"Stopped"** marker (the operator sees what arrived); connection state → **closed** (operator-initiated, NOT an error).

### Claude's Discretion (+ research/planner-owned)
- The exact **`/chat` + `/chat/stream` contract** (request/response shapes, the **streamed agent-step frame schema**, terminal/done framing, the **session_id mechanic**) — research MUST verify against `../llm-agent-customer-support/internal/httpapi/httpapi.go` (the `writeSSE` chat path) before the planner locks the renderer/session wiring.
- **How much of the Phase-3 SSE infra reuses cleanly vs needs a thin chat adapter** — chat agent-steps are a different frame schema than flow node-events, but the imperative-stream + connection-machine + append-render PATTERN is the same. Planner decides reuse-vs-adapt (a generic stream hook + a chat-specific reducer/renderer, or a thin wrapper over `useRunStream`).
- Step-trace collapse default + re-expand toggle visuals; where the sync/stream toggle lives in the composer — per UI-SPEC.
- Streaming indicator + "Stopped"/error in-bubble visuals — per UI-SPEC (reuse Phase-1/3 status tokens).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project specs (locked)
- `.planning/PROJECT.md` — verified customer-support route+auth inventory (customer-support `:8080`: `POST /chat`, `POST /chat/stream` SSE, `GET /healthz`, `GET /readyz`; **auth: none, IP rate-limited**).
- `.planning/REQUIREMENTS.md` — CHAT-01..03.
- `.planning/ROADMAP.md` §"Phase 4: Chat Console" — goal + 3 success criteria; Depends on Phase 3 (SSE client, pass-through, timeline renderer).

### Phase 3 substrate (REUSE — do not re-create)
- `.planning/phases/03-flow-console/03-RESEARCH.md` — the SSE-client architecture + the imperative-stream testing approach (mock `@microsoft/fetch-event-source`); the connection-state machine + abort semantics chat reuses.
- `web/src/features/flow/timeline/` (executed) — `useRunStream` (imperative stream, abort on terminal/unmount, the connection-state machine), the append reducer + renderer. The chat step-trace reuses this pattern (planner: reuse-vs-adapt).
- `web/src/lib/sse.ts` (executed) — `openSseStream` with the `onOpen` hook + abort.
- `web/src/test/mocks/fetch-event-source.ts` (executed) — the controllable fake SSE emitter to mirror for chat-frame tests.

### Phase 1 substrate
- `.planning/phases/01-foundation/01-03-SUMMARY.md` — the **chat director** (`/api/chat/*` → customer-support, NO auth injected — chat is auth-none), nginx SSE hardening.
- `.planning/phases/01-foundation/01-UI-SPEC.md` — base design system + the primitives (FiveStateWrapper, RawJsonViewer, CopyableId, status tokens, toast).

### Phase 2/3 patterns to mirror
- `web/src/features/flow/` + `web/src/features/memory/` — the `features/` layout, query-key factory (for any REST), the mock-harness approach. Mirror into `web/src/features/chat/`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 3 (executed):** the imperative SSE stack — `useRunStream`/abort, the connection-state machine, the append reducer+renderer, the fake SSE emitter test harness. The chat step-trace is the same pattern over a different frame schema.
- **Phase 1 (executed):** the BFF chat director (`/api/chat/*`, no auth), nginx SSE hardening. Console calls same-origin `/api/chat/*`.
- **Phases 1-3 primitives:** FiveStateWrapper, RawJsonViewer (for raw frames), CopyableId (session id), sonner, status tokens.

### Established Patterns
- **Streams are IMPERATIVE**, not TanStack Query (open on send, append frames to local state, close on terminal/stop/unmount). Any surrounding REST (none required beyond send) uses Query.
- Render all agent/chat strings as TEXT nodes (no `dangerouslySetInnerHTML`) — same XSS posture as Phases 2/3.
- Connection-state machine extends for Phase-5 reconnect; this phase ships manual Stop only.

### Integration Points
- **customer-support** (`:8080`) over HTTP at the BFF-configured URL — fixed contract (PROJECT.md / research). Auth: none.
- This is the third consumer of the Phase-3 SSE infra — validating it generalizes beyond flow runs.

</code_context>

<specifics>
## Specific Ideas

- **Two research targets the planner must resolve against `../llm-agent-customer-support` source BEFORE locking:**
  1. The **streamed agent-step frame schema** of `POST /chat/stream` (the `writeSSE` path in `internal/httpapi/httpapi.go`) — event/data shapes per step, the terminal/done framing, and the final-answer framing (so D-01's step-trace + final-answer split is grounded).
  2. The **session_id mechanic** — does `/chat`/`/chat/stream` return a server-assigned session id (reused on the next turn), or is it client-supplied? This grounds D-02/D-06 (header display + "New session" reset).
- Reuse-vs-adapt of the Phase-3 stream infra is the planner's structural call — a generic stream hook + chat reducer, or a thin wrapper over `useRunStream`.

</specifics>

<deferred>
## Deferred Ideas

- **Session-history list / switcher** — no browse endpoint; v1 single-active-session (D-02).
- **Reconnect / backoff** — Phase 5 (SHELL-02); this phase ships manual Stop + the extensible connection machine.
- **Keeping prior transcript visible across "New session"** — NOT chosen (D-06 clears to fresh); recorded as a possible later affordance if a history store appears.
- None of the above expand phase scope.

</deferred>

---

*Phase: 04-chat-console*
*Context gathered: 2026-06-04*
