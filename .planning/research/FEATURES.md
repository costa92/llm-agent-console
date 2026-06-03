# Feature Research

**Domain:** Internal admin/ops console (developer dashboard) over 3 backend services — memory gateway, flowd (flow engine), customer-support chat
**Researched:** 2026-06-03
**Confidence:** HIGH (architecture/constraints from verified PROJECT.md route code; UI patterns from ecosystem convention + current SSE sources)

## Orientation

This is an **operator tool**, not a consumer product. The bar is different from a SaaS app: operators forgive ugliness but not blindness. The cardinal sin for an ops console is **silent failure** — an action that appears to succeed but didn't, or a stream that died without telling you. So "table stakes" here is dominated by *legibility of state and outcome* (loading/error/empty states, raw-response access, request correlation), not by polish.

Three service-specific feature clusters drive v1: **memory browser + lifecycle editor**, **flow run viewer (live SSE)**, **streaming chat**. Everything else is the shared shell that makes those three usable.

### The one load-bearing technical constraint (read this first)

Native browser `EventSource` is **GET-only**, but the two streaming endpoints the console depends on are **POST**:
- flowd `POST /flows/{id}/run/stream`
- chat `POST /chat/stream`

(flowd `POST /runs/{id}/replay` is also POST + SSE.)

Therefore the live-run viewer and streaming chat **cannot** use plain `EventSource`. They must use `fetch()` with a streaming `ReadableStream` reader (or a library like `@microsoft/fetch-event-source` / `sse.js`) to send a POST body and parse the `text/event-stream` framing manually. This is MEDIUM complexity, not trivial, and it pushes a hard requirement onto the BFF: **the BFF must proxy SSE through without buffering** (flush per chunk, disable response buffering, no gzip on the stream, long/no read timeout). If the BFF buffers, the "live" viewer shows nothing until the run completes — which destroys the console's core value. This is the single highest-risk dependency in the project. [Confidence: HIGH]

---

## Feature Landscape

### Table Stakes (Operators Expect These)

Missing any of these makes the console feel broken or untrustworthy for ops work.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Service health indicators** (memory `/healthz`-equivalent, flowd `/healthz`, chat `/healthz`+`/readyz`) | Operator's first question is always "is the backend even up?" Core Value names this explicitly. | LOW | Poll on an interval (e.g. 10–30s) via BFF; render up/down/degraded dot per service in the shell. Don't over-engineer — a colored dot + last-checked timestamp. |
| **Loading / empty / error states for every view** | Ops data is frequently empty (no runs yet) or failing (backend down). Ambiguity here = operator can't trust the screen. | MEDIUM | This is the highest-leverage table stake. Every list/detail/stream needs all three. Treat as a cross-cutting requirement, not per-screen polish. |
| **Surfaced backend error responses (status + body)** | When a lifecycle action or run fails, the operator needs the *actual* upstream error, not a generic "something went wrong". | LOW | BFF must pass through upstream status code + error body. Toast on action failure must include the upstream message. |
| **Raw JSON viewer** | Operators cross-check the rendered UI against the actual payload; this is the escape hatch when the UI doesn't show a field. | LOW | Collapsible, syntax-highlighted, copy-to-clipboard. Reuse one component everywhere (memory item, run event, chat step, metrics). |
| **Tenant / user / (project / session) context entry** for gateway header auth | Gateway *requires* `X-Tenant-Id` + `X-User-Id`; memory console is non-functional without a way to set them. | MEDIUM | Persist in localStorage; show the active context in the shell at all times. BFF injects them as headers server-side. Optional `X-Project-Id`/`X-Session-Id`. **Memory console is dead without this.** |
| **Environment / endpoint selection** (which backend cluster the BFF targets) | Operators run against dev/staging/prod; pointing the console at the wrong env is dangerous, especially with destructive actions. | MEDIUM | Simplest correct v1: BFF is configured per-deployment (one origin = one env) and the UI *displays* the active env prominently. A UI env-switcher is a differentiator (see below), not table stakes — and it complicates secret handling. |
| **Toast / notification system** | Lifecycle actions (pin, disable, delete) need success/failure feedback; without it operators re-click and double-fire. | LOW | One toast system, used app-wide. Distinguish success vs error visually. |
| **Memory recall/search panel** (`POST /memory/recall/unified`) | The primary read path into memory; the console's memory value starts here. | MEDIUM | Query input + result list; each result is a memory item card linking to detail. Show score/metadata returned by recall. |
| **Memory item browse/detail** (`GET /memory/items/{id}`) | Operators inspect a single item before acting on it. | LOW | Detail view + raw JSON. Entry point for lifecycle actions. |
| **Memory lifecycle actions** (write, patch, pin/unpin, disable/enable, delete) | These are the gateway's whole operate surface; "ops console" implies you can act, not just look. | MEDIUM | Each maps to one gateway call. **Delete and disable must have confirmation** (see anti-features for what *not* to add). Patch/write need a JSON editor with validation. |
| **Flow list** (`GET /flows`) | Entry point to the flow console. | LOW | Table with name/id; row → flow detail. |
| **Flow detail + JSON edit** (`GET/PUT /flows/{id}`, `POST /flows`, `DELETE`) | v1 explicitly edits flow JSON (drag-drop DAG is out of scope). | MEDIUM | JSON editor (Monaco/CodeMirror) with schema-agnostic validation (valid JSON + PUT round-trip). Create/delete with confirmation on delete. |
| **Trigger a flow run** (`POST /flows/{id}/run` sync, and the streamed variant) | Can't be a flow *ops* console if you can't run a flow. | LOW (sync) / MEDIUM (stream) | Sync run = simple request/response. Streamed run = the live viewer below. |
| **Live run viewer rendering the SSE event stream** (`POST /flows/{id}/run/stream`) | This is the headline feature — watching node started/finished/done/error live is the reason the console exists for flows. | **HIGH** | POST+SSE via fetch-stream (see constraint above). Render events as an append-only timeline/log; per-node status; terminal `done`/`error`; auto-scroll with a "pause auto-scroll on manual scroll" affordance; show connection state (streaming / closed / errored). Depends on BFF SSE pass-through. |
| **Run history** (`GET /flows/{id}/runs`, `GET /runs/{id}`) | After a run ends, operators review what happened. | LOW | List of past runs; run detail with status/timestamps. |
| **Run event browse / replay** (`GET /runs/{id}/events`, `POST /runs/{id}/replay`) | Post-hoc debugging: re-watch a completed run's events. | MEDIUM | `/events` is a static fetch (easy). `/replay` is POST+SSE — reuses the live-viewer renderer. Build the renderer once, feed it from both live and replay sources. |
| **Streaming chat panel** (`POST /chat/stream`) | The chat console's core; rendering streamed agent *steps* (not just final text) is the value. | **HIGH** | POST+SSE via fetch-stream. Render incremental agent steps + final message; session continuity (keep session id across turns); typing/streaming indicator; stop-on-error. Same streaming infra as run viewer. |
| **Chat sync fallback** (`POST /chat`) | Useful when streaming fails or for quick one-shots; cheap given the endpoint exists. | LOW | Non-streaming send; reuse message rendering. |

### Differentiators (Operator-Grade Advantages)

Not required for v1 to be useful, but these are what make operators *prefer* this console. They align with the Core Value ("see and act on what the backends are doing").

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Top-line gateway metrics view** (`GET /metrics`) | At-a-glance memory-gateway health beyond up/down, without opening Grafana. | MEDIUM | Parse Prometheus exposition format; show a handful of key counters/gauges. **Stay top-line** — PROJECT.md explicitly says don't rebuild Grafana. Easy to over-scope; cap it. |
| **Keyboard navigation / command palette** | Power operators live in the keyboard; cmd-palette to jump services/runs is a real speed win. | MEDIUM | A ⌘K palette (jump to service, paste a run/item id to open it) is high-value for a daily-driver tool. Defer to v1.x — table-stakes views must exist first. |
| **Request/run correlation + copyable IDs** | When an operator escalates ("run X failed"), having the id one click away to copy/share is gold. | LOW | Show run/item/session ids prominently with copy buttons; deep-linkable URLs (`/runs/{id}`). |
| **SSE auto-reconnect with resume** | Long flows + flaky networks: resume the stream instead of losing the view. | MEDIUM-HIGH | flowd would need to honor `Last-Event-ID`; if it doesn't, best you can do is reconnect + re-fetch `/runs/{id}/events` to backfill. Verify backend support before promising resume. |
| **UI environment switcher** (dev/staging/prod) | One console for all envs instead of multiple deployments. | MEDIUM-HIGH | Real value but real risk: multiple env secrets in one BFF, and a wrong-env destructive action is a footgun. If built, gate destructive actions behind an env-aware confirmation. Defer past v1. |
| **Session context viewer** (close/heartbeat state via `POST /memory/sessions/{id}/close|heartbeat`) | Operators managing memory sessions need to see/act on session lifecycle. | LOW-MEDIUM | These are POST actions (no GET to read state directly per the route list) — surface the actions + show last-action result. Don't fabricate a session-state view the backend doesn't expose. |
| **Dark mode** | Operators stare at this for hours. | LOW | Cheap with any modern component lib; genuinely appreciated. Not v1-blocking. |

### Anti-Features (Tempting, But Avoid in v1)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Visual drag-and-drop DAG / flow builder** | "It'd be nice to edit flows graphically." | Large effort; PROJECT.md explicitly defers it; v1 must first prove the read/run path is valuable. | JSON editor with validation (table stakes). Graphical builder is v2+ *after* validation. |
| **Full metrics dashboards / charts over time** | "We have `/metrics`, let's chart everything." | Rebuilds Grafana, which already ships in the compose stack; unbounded scope; competes with a better tool. | Top-line metrics view only (differentiator), capped at a few key numbers. Link out to Grafana. |
| **Per-end-user login / RBAC / user management** | "Consoles have auth." | This is an *internal operator* tool; the BFF holds operator-side credentials. Building multi-tenant SaaS auth is out of scope and large. | Single trusted-network/operator deployment; auth at the BFF/ingress layer, not in-app. |
| **Optimistic UI for destructive lifecycle actions** | "Feels snappy." | For delete/disable, showing success before the backend confirms can hide failures — exactly the silent-failure sin an ops tool must avoid. | Pessimistic UI: wait for the backend, then toast the real outcome. Optimism is fine for cheap reversible reads, not for delete. |
| **Bulk lifecycle operations** (select-many delete/disable) | "Faster to clean up many items." | Multiplies blast radius; one mis-click nukes many items; gateway calls are per-id anyway. | Single-item actions with confirmation in v1. Revisit bulk only with strong demand + safeguards. |
| **WebSockets for run/chat streaming** | "More real-time / bidirectional." | The backends already speak SSE (one-way server→client), which is exactly the right fit; WS adds connection-management complexity for no gain. | Use SSE-over-fetch as the backends provide. Don't introduce a second transport. |
| **Auto-refreshing/polling every list aggressively** | "Always show latest." | Hammers backends, fights with the operator's scroll position, masks staleness bugs. | Manual refresh button + targeted polling only for health dots and active runs (which stream anyway). |
| **Re-implementing flow logic / client-side run simulation** | "Preview what a run will do." | Duplicates backend behavior; drifts from truth; huge effort. | Just run it (sync or streamed) and render the real events. |
| **Rich WYSIWYG editor for memory content** | "Nicer than JSON." | Memory items are structured payloads; a WYSIWYG layer hides/garbles fields. | JSON editor with validation + raw viewer. |

---

## Feature Dependencies

```
BFF SSE pass-through (no buffering, flush-per-chunk, long timeout)
    └──required by──> Live run viewer (POST /flows/{id}/run/stream)
    └──required by──> Replay viewer (POST /runs/{id}/replay)
    └──required by──> Streaming chat (POST /chat/stream)

fetch-based SSE client (EventSource is GET-only; these are POST)
    └──required by──> Live run viewer
    └──required by──> Replay viewer
    └──required by──> Streaming chat

SSE event-timeline renderer (append-only, per-node status, terminal state)
    └──shared by──> Live run viewer
    └──shared by──> Replay viewer        (feed from /runs/{id}/events or /replay)
    └──partially reused by──> Streaming chat (agent steps timeline)

Tenant/User context entry + BFF header injection (X-Tenant-Id, X-User-Id)
    └──required by──> ALL memory features (recall, browse, lifecycle, sessions)

Raw JSON viewer component
    └──reused by──> memory item / run event / chat step / metrics

Toast system
    └──required by──> all lifecycle actions, flow CRUD, run trigger feedback

Health-indicator polling (BFF) ──enhances──> shell (always-visible status)

Flow list ──requires──> Flow detail ──requires──> Run trigger ──requires──> Live run viewer
Run trigger ──produces──> Run history ──links to──> Replay viewer
```

### Dependency Notes

- **Everything streaming depends on BFF SSE pass-through.** If the BFF buffers the upstream response (common default with reverse proxies, gzip, or response-buffering middleware), the live viewer and chat appear frozen until completion. This must be verified end-to-end *early* — it's the project's keystone risk. The same dependency covers replay.
- **All memory features depend on the tenant/user context entry.** The gateway rejects calls without `X-Tenant-Id`/`X-User-Id`. The context UI + BFF injection must land before any memory screen is testable. Order the roadmap so context entry precedes memory CRUD.
- **Build the SSE event-timeline renderer once.** Live run, replay, and (in spirit) chat steps all render an append-only event stream. A single renderer fed by different sources avoids triplicate work and is the natural shared component.
- **`fetch`-based SSE client is shared infra**, not a per-feature concern. Implement it once (POST body + `text/event-stream` parsing + connection-state callbacks) and reuse for all three streams.
- **Flow CRUD → run → history → replay is a linear chain.** Earlier links must exist for later ones to be reachable, which suggests phase ordering inside the flow console.

---

## MVP Definition

### Launch With (v1)

The minimum that delivers the Core Value — "see and act on what the backends are doing" across all three services.

- [ ] **Shared shell**: nav across 3 service consoles, always-visible health dots, active env display, active tenant/user context display. — *the frame everything hangs on*
- [ ] **BFF**: single origin, server-side auth injection (gateway headers, flowd bearer, chat none), **verified SSE pass-through**. — *without this nothing streams; without it memory auth fails*
- [ ] **Cross-cutting primitives**: loading/empty/error states, toasts, raw JSON viewer, copyable IDs. — *legibility; the ops-tool table stake*
- [ ] **Memory console**: tenant/user context entry → recall/search → item detail → lifecycle actions (write/patch/pin/unpin/disable/enable/delete with confirm on destructive). — *full memory operate surface*
- [ ] **Flow console**: list → detail (JSON edit, create/delete) → trigger run → **live SSE run viewer** → run history → event browse/replay. — *the headline live-run capability*
- [ ] **Chat console**: streaming chat panel (agent steps) with session continuity + sync fallback. — *the third service's value*

### Add After Validation (v1.x)

- [ ] **Command palette / keyboard nav** — once daily-driver usage is established and operators ask for speed.
- [ ] **Top-line gateway metrics view** — once health dots prove insufficient and operators want numbers without Grafana.
- [ ] **SSE auto-reconnect + backfill** — when long flows on flaky networks cause lost views in practice. *(Verify flowd `Last-Event-ID` support first.)*
- [ ] **Dark mode** — cheap quality-of-life once the surface stabilizes.
- [ ] **Session context actions surfaced** (close/heartbeat) — when memory-session ops become a real workflow.

### Future Consideration (v2+)

- [ ] **Visual DAG flow builder** — only after the JSON-edit + run path proves the flow console valuable.
- [ ] **UI environment switcher** — only with env-aware destructive-action guards; high footgun risk.
- [ ] **Bulk lifecycle operations** — only with strong demand and blast-radius safeguards.

---

## Feature Prioritization Matrix

| Feature | Operator Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| BFF + verified SSE pass-through | HIGH | MEDIUM | P1 |
| Cross-cutting states (loading/empty/error) + toasts + raw JSON | HIGH | MEDIUM | P1 |
| Tenant/user context entry + header injection | HIGH | MEDIUM | P1 |
| Health indicators | HIGH | LOW | P1 |
| Memory recall/search + item detail | HIGH | MEDIUM | P1 |
| Memory lifecycle actions (with confirm) | HIGH | MEDIUM | P1 |
| Flow list + detail (JSON edit/CRUD) | HIGH | MEDIUM | P1 |
| Trigger run (sync + stream) | HIGH | MEDIUM | P1 |
| Live SSE run viewer (event timeline) | HIGH | HIGH | P1 |
| Run history + event browse/replay | MEDIUM | MEDIUM | P1 |
| Streaming chat panel + session continuity | HIGH | HIGH | P1 |
| Chat sync fallback | LOW | LOW | P1 |
| Command palette / keyboard nav | MEDIUM | MEDIUM | P2 |
| Top-line metrics view | MEDIUM | MEDIUM | P2 |
| SSE auto-reconnect/resume | MEDIUM | MEDIUM-HIGH | P2 |
| Dark mode | LOW | LOW | P2 |
| UI env switcher | MEDIUM | MEDIUM-HIGH | P3 |
| Visual DAG builder | MEDIUM | HIGH | P3 |
| Bulk lifecycle ops | LOW | MEDIUM | P3 |

**Priority key:** P1 = must have for launch · P2 = add when possible · P3 = future consideration

---

## Competitor / Reference Feature Analysis

How comparable run/stream consoles handle the headline patterns (informs our approach):

| Pattern | Reference (how it's done in the wild) | Our Approach |
|---------|---------------------------------------|--------------|
| Live run/log streaming | GitHub Actions logs, Vercel deploy logs, Stripe event feeds all stream via SSE with append-only auto-scroll log + terminal status | Append-only event timeline, per-node status, terminal `done`/`error`, auto-scroll with pause-on-manual-scroll |
| Streaming AI chat | Most LLM chat UIs render token/step streams via SSE-over-fetch (POST body), not raw `EventSource` | `fetch`-stream client (or `@microsoft/fetch-event-source`); render agent steps incrementally |
| Reconnection | Native `EventSource` auto-reconnects (~3s) + `Last-Event-ID` resume — but only for GET | We're POST, so no native reconnect; manual reconnect + `/runs/{id}/events` backfill if needed (v1.x) |
| Admin-panel scaffolding | Refine / admin-panel builders provide CRUD + table/detail + auth scaffolding out of the box | Consider an admin scaffold for memory/flow CRUD, but the SSE viewer is custom regardless |

---

## Sources

- Project route inventory & constraints: verified `PROJECT.md` (memory-gateway, flowd, customer-support route code) [Confidence: HIGH]
- EventSource is GET-only; POST-SSE requires fetch-stream / polyfill: [Alexander Solovyov — SSE but with POST](https://solovyov.net/blog/2023/eventsource-post/), [MDN — Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events), [@microsoft/fetch-event-source](https://medium.com/pon-tech-talk/extend-the-usage-of-the-eventsource-api-with-microsoft-fetch-event-source-a5c83ff95964), [sse.js polyfill](https://github.com/mpetazzoni/sse.js/) [Confidence: HIGH]
- SSE UI patterns (auto-scroll, heartbeat, reconnect, real-world use in GitHub/Vercel/Stripe logs): [dev.to SSE guide](https://dev.to/serifcolakel/real-time-data-streaming-with-server-sent-events-sse-1gb2), [What Are SSE — 2026 dev guide](https://dev.to/napster_rj/what-are-server-sent-events-sse-a-developers-guide-for-2026-4jb6), [OneUptime — SSE in React](https://oneuptime.com/blog/post/2026-01-15-server-sent-events-sse-react/view) [Confidence: MEDIUM]
- Admin/ops console feature conventions: [Refine — What is an Admin Panel (2026)](https://refine.dev/blog/what-is-an-admin-panel/), [WeWeb — Admin panel builders 2026](https://www.weweb.io/blog/best-admin-panel-builder-tools) [Confidence: MEDIUM]

---
*Feature research for: internal admin/ops console over memory-gateway + flowd + customer-support chat*
*Researched: 2026-06-03*
