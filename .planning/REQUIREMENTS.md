# Requirements — llm-agent-console

**Milestone:** v1 — unified operator console over the three ecosystem services
**Core Value:** turn the headless service APIs into one usable, observable operator surface.

Requirements are user-centric ("Operator can …"), specific, and testable. All v1 items are
hypotheses until shipped and validated.

---

## v1 Requirements

### BFF — single-origin proxy + auth + streaming

- [x] **BFF-01**: Operator reaches all three backends through **one origin**; the BFF maps allowlisted routes to the memory-gateway, flowd, and chat upstreams (no open pass-through, no SSRF).
- [x] **BFF-02**: The BFF **injects each service's auth server-side**. Operator context arrives from the browser as `X-Console-Tenant`/`X-Console-User`/`X-Console-Project`/`X-Console-Session` headers and is **re-materialized server-side** into the gateway `X-Tenant-Id`/`X-User-Id` (and optional `X-Project-Id`/`X-Session-Id`); the flowd `Authorization: Bearer` comes from server config. The BFF **strips ALL inbound `X-*-Id` scope headers and the inbound `Authorization`** before re-materializing, and **never exposes the flowd token to the browser**. (The optional operator token the browser sends as `Authorization: Bearer` is authenticated and consumed at the app layer, not forwarded.)
- [x] **BFF-03**: The BFF **proxies SSE responses unbuffered** — flush per event, no gzip on `text/event-stream`, long/no read timeout, `X-Accel-Buffering: no` — verified end-to-end (a `POST` stream renders incrementally, not all-at-once, through a real fronting proxy).
- [x] **BFF-04**: The BFF **passes through upstream status codes and error bodies** so the UI can surface the actual backend error, not a generic message.

### SHELL — app frame + cross-cutting legibility

- [x] **SHELL-01**: Operator navigates between the Memory, Flow, and Chat consoles from a persistent shell/nav.
- [ ] **SHELL-02**: Operator sees **always-visible per-service health** (up / down / degraded) for memory-gateway, flowd, and chat, polled on an interval, with a last-checked timestamp.
- [x] **SHELL-03**: Operator sets and sees the **active operator context** (tenant id, user id, optional project/session id), persisted across reloads and displayed in the shell at all times.
- [x] **SHELL-04**: The active **environment/endpoint** the BFF targets is displayed prominently in the shell.
- [x] **SHELL-05**: Every list/detail/stream view renders explicit **loading, empty, and error states** (no ambiguous blank screens).
- [x] **SHELL-06**: Operator gets **toast feedback** (success/failure, with the upstream message on failure) for every write/lifecycle/run action.
- [x] **SHELL-07**: Operator can view the **raw JSON** of any item/event/response in a collapsible, copy-to-clipboard viewer, and copy resource ids (memory/run/session) with one click.

### MEM — memory console

- [x] **MEM-01**: Operator runs a **recall/search** (`POST /memory/recall/unified`) and sees ranked results with score and metadata; each result links to its item detail.
- [ ] **MEM-02**: Operator opens a **memory item detail** (`GET /memory/items/{id}`) with rendered fields plus raw JSON.
- [x] **MEM-03**: Operator **writes** a new memory record (`POST /memory/write`) via a validated JSON editor.
- [x] **MEM-04**: Operator **patches** an existing memory item (`PATCH /memory/items/{id}`).
- [ ] **MEM-05**: Operator **pins / unpins** a memory item (`POST .../pin|unpin`).
- [ ] **MEM-06**: Operator **disables / enables** a memory item (`POST .../disable|enable`).
- [ ] **MEM-07**: Operator **deletes** a memory item (`DELETE /memory/items/{id}`); delete and disable require a **confirmation step** and use **pessimistic** UI (reflect state only after the backend confirms).
- [x] **MEM-08**: All memory actions are **gated behind operator context** (SHELL-03) — the console clearly indicates when tenant/user is unset and memory is therefore unavailable.

### FLOW — flow console

- [ ] **FLOW-01**: Operator sees a **list of flows** (`GET /flows`); a row opens flow detail.
- [ ] **FLOW-02**: Operator views and **edits a flow's JSON** (`GET/PUT /flows/{id}`), **creates** (`POST /flows`), and **deletes** (`DELETE`, with confirmation), using a JSON editor that validates well-formedness and round-trips on PUT.
- [ ] **FLOW-03**: Operator **triggers a synchronous run** (`POST /flows/{id}/run`) and sees its outputs/result.
- [ ] **FLOW-04**: Operator **triggers a streamed run** (`POST /flows/{id}/run/stream`) and watches a **live append-only event timeline** (node started/finished, terminal done/error) with per-node status, auto-scroll that pauses on manual scroll, and a visible connection state (streaming / closed / errored).
- [ ] **FLOW-05**: Operator browses **run history** for a flow (`GET /flows/{id}/runs`) and opens a **run detail** (`GET /runs/{id}`) with status and timestamps.
- [ ] **FLOW-06**: Operator browses a completed run's **events** (`GET /runs/{id}/events`) and **replays** them (`POST /runs/{id}/replay`) in the same timeline renderer used for live runs.

### CHAT — chat console

- [ ] **CHAT-01**: Operator sends a message and watches **streamed agent steps** (`POST /chat/stream`) render incrementally, with a streaming indicator and stop-on-error.
- [ ] **CHAT-02**: Chat maintains **session continuity** (reuses the session id across turns).
- [ ] **CHAT-03**: Operator can use a **sync fallback** (`POST /chat`) for one-shot messages, reusing the same message rendering.

---

## v2 Requirements (deferred — add after validation)

- [ ] Command palette / keyboard navigation (⌘K jump to service / open id).
- [ ] Top-line gateway **metrics view** (`GET /metrics`, capped — not a Grafana replacement).
- [ ] **SSE auto-reconnect + backfill** (reconnect, re-fetch `/runs/{id}/events`); requires verifying flowd `Last-Event-ID` support.
- [ ] Dark mode.
- [ ] Surfaced **session close/heartbeat actions** (`POST /memory/sessions/{id}/close|heartbeat`).

## Out of Scope

- **Visual drag-and-drop DAG / flow builder** — large; v1 edits JSON. Revisit after the read/run path proves valuable.
- **Full metrics dashboards / time-series charts** — Grafana already ships in the compose stack; link out instead.
- **Per-end-user login / RBAC / user management** — internal operator tool; auth lives at the BFF/ingress, not in-app.
- **Optimistic UI on destructive actions** — would hide silent failures; pessimistic confirm-then-reflect only.
- **Bulk lifecycle operations** — blast-radius risk; single-item with confirmation in v1.
- **WebSockets** — backends already speak SSE correctly; no second transport.
- **UI environment switcher** — footgun with destructive actions; one deployment per env in v1.
- **Modifying the backend services** (e.g. adding CORS) — consume contracts as-is; the BFF absorbs the difference.

---

## Traceability

<!-- REQ-ID → Phase. Mapped by roadmap 2026-06-03. -->

| REQ-ID | Phase |
|--------|-------|
| BFF-01 | Phase 1 — Foundation |
| BFF-02 | Phase 1 — Foundation |
| BFF-03 | Phase 1 — Foundation (keystone SSE acceptance gate; consumed by Phase 3) |
| BFF-04 | Phase 1 — Foundation |
| SHELL-01 | Phase 1 — Foundation |
| SHELL-03 | Phase 1 — Foundation |
| SHELL-04 | Phase 1 — Foundation |
| SHELL-05 | Phase 1 — Foundation |
| SHELL-06 | Phase 1 — Foundation |
| SHELL-07 | Phase 1 — Foundation |
| MEM-01 | Phase 2 — Memory Console |
| MEM-02 | Phase 2 — Memory Console |
| MEM-03 | Phase 2 — Memory Console |
| MEM-04 | Phase 2 — Memory Console |
| MEM-05 | Phase 2 — Memory Console |
| MEM-06 | Phase 2 — Memory Console |
| MEM-07 | Phase 2 — Memory Console |
| MEM-08 | Phase 2 — Memory Console |
| FLOW-01 | Phase 3 — Flow Console |
| FLOW-02 | Phase 3 — Flow Console |
| FLOW-03 | Phase 3 — Flow Console |
| FLOW-04 | Phase 3 — Flow Console |
| FLOW-05 | Phase 3 — Flow Console |
| FLOW-06 | Phase 3 — Flow Console |
| CHAT-01 | Phase 4 — Chat Console |
| CHAT-02 | Phase 4 — Chat Console |
| CHAT-03 | Phase 4 — Chat Console |
| SHELL-02 | Phase 5 — Health & Hardening |
