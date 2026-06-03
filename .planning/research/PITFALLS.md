# Pitfalls Research

**Domain:** Internal admin/ops console + thin single-origin BFF/reverse-proxy with SSE streaming over three heterogeneous backends (header-scope auth gateway, bearer-auth flowd, unauthenticated chat)
**Researched:** 2026-06-03
**Confidence:** HIGH (SSE-proxy + EventSource semantics verified against MDN/WHATWG + 2025-2026 production guides; BFF/auth + frontend pitfalls are well-established patterns)

> Phase names below are *suggested* and map to the natural build order for this project:
> **P1 BFF skeleton & proxy** → **P2 SSE streaming path** → **P3 Memory console (REST + CRUD)** → **P4 Flow console (runs/replay)** → **P5 Chat console** → **P6 Health/observability & polish**.
> The roadmap may renumber; the *ordering relationships* are what matter.

---

## Critical Pitfalls

### Pitfall 1: SSE buffered/broken by the BFF reverse-proxy layer (the #1 failure for this app)

**What goes wrong:**
Live flowd runs and chat steps arrive at the browser in delayed bursts — or not until the run *completes* — instead of token-by-token. The console's entire core value ("see what the backend is doing live") silently degrades to "watch a spinner, then see everything at once." Often looks fine on localhost and breaks only once a real proxy (nginx/cloud LB) sits in front.

**Why it happens:**
Every layer between flowd/chat and the browser buffers by default. The failure is multi-layered and any one layer breaks it:
- The BFF's own HTTP framework buffers the response body and never flushes per-chunk.
- A reverse proxy (nginx) has `proxy_buffering on` by default and accumulates the upstream stream.
- gzip/compression middleware (nginx `gzip`, Go `gziphandler`, CDN) buffers to compress.
- HTTP/1.1 chunked-encoding transforms or a `Content-Length` expectation defeat streaming.

**How to avoid:**
- BFF must `Flush()` after **every** SSE event write (Go: assert `http.Flusher` and call `Flush()`; or use `http.ResponseController`). Streaming the upstream `io.Reader` with a default `io.Copy` through a buffering writer is the classic trap — copy-and-flush in small chunks.
- On every SSE response set: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, and **`X-Accel-Buffering: no`** (the magic header that tells nginx to disable buffering for *this* response — survives even if you don't control the nginx config).
- **Disable compression on SSE routes.** Never let gzip middleware touch `text/event-stream`.
- If you ship an nginx/ingress config: `proxy_buffering off; proxy_cache off; proxy_http_version 1.1; gzip off;` on SSE locations, and raise `proxy_read_timeout`.
- Disable any response buffering in the BFF framework explicitly for SSE routes.

**Warning signs:**
- Events appear in one batch at the end of a run.
- `curl -N <bff>/flows/{id}/run/stream` streams immediately but the browser doesn't → a proxy/middleware layer is buffering.
- Works locally, breaks in staging/prod (the proxy only exists there).
- Response has `Content-Encoding: gzip` on an SSE route.

**Phase to address:** **P2 (SSE streaming path)** — make a single end-to-end streaming proof (flowd → BFF → browser) the *first* SSE deliverable, with `curl -N` and a real browser as acceptance gates, before building any flow UI.

---

### Pitfall 2: Proxy/idle timeouts kill long-running streams

**What goes wrong:**
A long flow run or a slow chat completion is severed mid-stream after 30–60s of perceived inactivity. The browser sees a dropped connection, EventSource auto-reconnects, and (without replay) the run appears to "restart" or lose its earlier output. Operators distrust the console because long runs never finish on screen.

**Why it happens:**
- Proxy idle/read timeouts (`proxy_read_timeout`, cloud LB idle timeout ~60s) fire when no bytes flow during a quiet period of the run.
- The BFF's own server write/read timeouts are set globally and not relaxed for streaming routes.
- Backends may emit nothing during a long step, so the connection *looks* idle.

**How to avoid:**
- Emit a **heartbeat/keepalive** from the BFF on a timer (e.g. an SSE comment line `: keepalive\n\n` every 15–20s) so the connection never looks idle. This is the single most effective fix.
- Set generous (or zero/disabled) read timeouts on SSE routes in the BFF; do **not** apply a global short `WriteTimeout` to streaming handlers.
- Raise proxy idle/read timeouts on SSE locations and document the required LB idle-timeout for deployment.

**Warning signs:**
- Streams die at a suspiciously round interval (30s/60s/120s).
- Reconnects cluster around quiet phases of a run.
- Short flows work; long flows always cut off.

**Phase to address:** **P2 (SSE streaming path)** — heartbeat is part of the streaming primitive, not a later add-on.

---

### Pitfall 3: EventSource auto-reconnect storms

**What goes wrong:**
When a stream errors (backend down, BFF restart, timeout), the browser's EventSource silently retries — by default every ~3s — forever, per open stream. With several run/chat tabs open, a backend outage produces a reconnect storm hammering the BFF and backends, and the UI shows nothing but a spinner.

**Why it happens:**
EventSource auto-reconnects by design (HTML spec default retry 3000ms) and there is **no built-in backoff or cap**. Developers treat reconnection as "free" and never surface errors or close dead streams. Naive BFF proxies forward a 200 then close, so the browser keeps re-establishing a doomed stream.

**How to avoid:**
- Have the BFF send a `retry:` field to widen the client retry interval where appropriate.
- Implement client-side backoff/cap: on repeated `onerror`, increase delay and after N failures **`eventSource.close()`** and show an explicit "stream disconnected — retry?" state instead of silently reconnecting forever.
- Distinguish *terminal* stream end (run finished → BFF should signal completion and the client must `close()`, because EventSource would otherwise reconnect to a finished run) from *transient* errors. Send an explicit `event: done` / `event: end` so the client knows to stop.
- Close streams when a tab/view is unmounted or hidden.

**Warning signs:**
- BFF logs show the same client reconnecting every ~3s.
- A finished run keeps re-opening a stream (EventSource reconnecting to a completed run).
- Backend request volume spikes during outages instead of backing off.

**Phase to address:** **P2** for the BFF-side `retry:`/`done` signaling and terminal-end semantics; **P4/P5** for per-console client backoff + disconnected UI state.

---

### Pitfall 4: Late joiners lose events because replay isn't wired in

**What goes wrong:**
An operator opens a run that's already in progress (or reconnects after a drop) and sees only events *from now on* — the first half of the run is missing. The console looks broken even though flowd has the full history.

**Why it happens:**
SSE only delivers events that occur *after* the connection opens. The flowd API explicitly provides the mitigation — `GET /runs/{id}/events` (full history) and `POST /runs/{id}/replay` (SSE replay) — but teams wire only the live `/run/stream` and forget the catch-up path. Note: flowd's replay is a **separate replay endpoint**, not a same-stream `Last-Event-ID` resume, so the standard EventSource auto-replay does *not* apply here unless the BFF bridges it.

**How to avoid:**
- For any run not opened brand-new, **hydrate from `/runs/{id}/events` first, then attach the live stream** — and de-duplicate the overlap by event id/sequence.
- On reconnect, prefer `/runs/{id}/replay` (or `/events` + dedupe) rather than assuming the live stream resumes cleanly.
- Track the last-seen event id/sequence per run on the client so hydrate-then-stream can drop already-seen events.
- For chat (no replay endpoint, no auth), accept that a dropped chat stream loses in-flight tokens; keep persisted turns server-authoritative and only the streaming delta ephemeral.

**Warning signs:**
- Opening an in-progress run shows fewer events than the run actually emitted.
- Reconnect shows a gap in the event timeline.
- Duplicate events after reconnect (you wired replay but didn't dedupe).

**Phase to address:** **P4 (Flow console)** — "browse past runs + replay" is a stated requirement; design hydrate-then-stream + dedupe up front, not after the live path "works."

---

### Pitfall 5: Leaking the flowd bearer token (and gateway scope) to the browser

**What goes wrong:**
The whole reason for the BFF is server-side auth injection. If the flowd `FLOWD_TOKEN` ends up in client JS, a network response, a query string, or browser-readable storage, the console's security model collapses — anyone with the browser can hit flowd directly.

**Why it happens:**
- Convenience: passing the token to the frontend so EventSource "just works" (and EventSource *cannot set custom headers*, which tempts devs to stuff the token in a query string or expose it).
- Token echoed back in a debug/health/config endpoint the BFF exposes.
- Token placed in the SSE URL (`?token=...`) where it lands in proxy/access logs.

**How to avoid:**
- The bearer token lives **only** in BFF server config/env and is injected on the *outbound* request to flowd. It must never appear in any BFF→browser response, URL, or log.
- Because EventSource can't send `Authorization`, the **browser authenticates to the BFF via same-origin session cookie**, and the BFF (not the browser) adds the bearer on the upstream hop. This is the correct single-origin pattern and a primary justification for the BFF.
- Audit: grep BFF responses and front-end bundle for the token; ensure `/healthz`/config endpoints don't echo secrets.
- Never log full upstream request headers on SSE routes.

**Warning signs:**
- `FLOWD_TOKEN` or any bearer string visible in DevTools Network/response or in the JS bundle.
- SSE URLs containing `?token=`.
- Tokens appearing in access logs.

**Phase to address:** **P1 (BFF skeleton & proxy)** — auth-injection boundary and "no secret crosses to the browser" is a foundational invariant; add a test/grep gate.

---

### Pitfall 6: Confused-deputy / SSRF in a naive proxy + gateway header trust

**What goes wrong:**
A "pass everything through" proxy lets the browser control which upstream is hit or which tenant/user scope is used. Two concrete risks here:
1. **SSRF / open proxy:** the BFF forwards an arbitrary client-supplied path or host to "the backend," letting a browser reach internal services it shouldn't.
2. **Header-scope spoofing:** the gateway trusts `X-Tenant-Id`/`X-User-Id` headers for auth. If the BFF forwards client-supplied versions of these headers (or lets the client influence them), a browser can impersonate any tenant/user — the gateway has *no other auth*.

**Why it happens:**
- Generic reverse-proxy code (`httputil.ReverseProxy` with a wildcard director) forwards path/host/headers verbatim for convenience.
- The gateway's auth is "whatever headers arrive," so any inbound `X-Tenant-Id` the BFF doesn't strip is trusted.

**How to avoid:**
- **Allowlist routes, not pass-through.** The BFF should expose explicit, mapped endpoints to each backend — never a generic "proxy to URL X" handler.
- **Strip inbound `X-Tenant-Id`/`X-User-Id`/`X-Project-Id`/`X-Session-Id` from the client request and set them server-side** from the BFF's authenticated operator context. The client must not be able to inject scope headers.
- Pin upstream base URLs in BFF config; never derive the target host from client input.
- Drop hop-by-hop and auth headers the client shouldn't control before forwarding.

**Warning signs:**
- A single BFF handler that takes a target URL/path from the request.
- Gateway requests succeed with client-supplied tenant headers.
- The BFF forwards request headers it didn't explicitly set.

**Phase to address:** **P1 (BFF skeleton & proxy)** — design the proxy as explicit mapped routes with server-set scope from day one. Re-verify in **P3 (Memory console)** where the gateway scope headers are exercised.

---

### Pitfall 7: Unbounded growth of streamed run/chat logs in DOM and memory

**What goes wrong:**
A long flow run or chat session streams thousands of events; the frontend appends each to React/Vue state and renders every one into the DOM. The tab's memory climbs, scroll/render jank sets in, and eventually the operator's browser tab slows to a crawl or crashes — exactly during the long runs the console exists to observe.

**Why it happens:**
- Naive `setState(events => [...events, newEvent])` keeps unbounded arrays and re-renders the whole list each event.
- Every event becomes a DOM node; no virtualization.
- Verbose backends (token-level chat streaming) make this acute.

**How to avoid:**
- **Virtualize** long event/log lists (render only visible rows).
- Cap retained events with a ring buffer / "load earlier" affordance; don't hold the entire run in component state when history is fetchable from `/runs/{id}/events`.
- Batch/coalesce high-frequency events (e.g. flush to state on animation frame) instead of one re-render per token.
- Append immutably but to a bounded structure; avoid re-cloning huge arrays per event.

**Warning signs:**
- Tab memory grows steadily during a run; doesn't release after.
- Scroll/typing jank that worsens with run length.
- Frame drops correlated with event rate.

**Phase to address:** **P4 (Flow console)** and **P5 (Chat console)** — establish a shared virtualized/bounded log component once and reuse it for both streams.

---

### Pitfall 8: Race conditions between REST cache and live SSE updates

**What goes wrong:**
The console shows a run/memory item via a REST fetch *and* a live SSE stream. The two disagree: a late REST response overwrites newer SSE state (stale snapshot wins), or SSE events applied before the initial snapshot get clobbered. The UI flickers between old and new, or shows an inconsistent timeline.

**Why it happens:**
- Snapshot (REST) and stream (SSE) are merged without ordering guarantees; whichever resolves last wins.
- No sequence/version key to reconcile snapshot vs. incremental events.
- Hydrate-then-stream (Pitfall 4) without dedupe produces the inverse problem.

**How to avoid:**
- Establish a clear reconciliation rule: **fetch snapshot, note its high-water sequence/timestamp, then apply only stream events newer than that.**
- Use event ids/sequence numbers as the source of truth for ordering; ignore out-of-order/duplicate ids.
- Make the stream authoritative for *live* state and REST authoritative for *historical/initial* state, with an explicit handoff — not a "last write wins" merge.

**Warning signs:**
- UI briefly shows newer state then reverts to older.
- Event count differs across refreshes of the same run.
- Order of events occasionally scrambles after a reconnect.

**Phase to address:** **P4 (Flow console)** — first place snapshot+stream coexist. Apply the same rule wherever REST cache and SSE overlap.

---

### Pitfall 9: Optimistic memory-CRUD desync with the gateway

**What goes wrong:**
The memory console optimistically reflects a write/patch/pin/disable/delete, but the gateway rejects or transforms it (validation, different canonical form, eventual consistency in recall). The UI shows a state the backend never accepted; a later recall/refresh contradicts it, confusing the operator about what's actually stored.

**Why it happens:**
- Optimistic updates applied without reconciling against the server's response/canonical representation.
- No rollback on error; the optimistic state lingers.
- Mutations (`/memory/write`, `PATCH`, pin/disable/delete) succeed but `recall/unified` reflects them with a lag, read as a bug.

**How to avoid:**
- Reconcile optimistic state with the gateway's actual response; on error, **roll back** and surface the failure.
- After a mutation, invalidate/refetch the affected item (`GET /memory/items/{id}`) rather than trusting the optimistic guess.
- For irreversible/destructive ops (delete, disable) prefer confirm-then-reflect over silent optimism, or at least clear rollback + toast on failure.
- Don't assume recall instantly reflects a write; show pending/just-written state explicitly if there's lag.

**Warning signs:**
- Item shows "pinned/deleted" but reappears unchanged on refresh.
- Errors leave stale optimistic state on screen.
- Operators report "I deleted it but it's back."

**Phase to address:** **P3 (Memory console)** — CRUD reconciliation strategy is core to this console.

---

### Pitfall 10: Poor empty / error / loading / disconnected states (the ops-tool trust killer)

**What goes wrong:**
An ops console that only renders the happy path is *actively harmful*: a blank panel could mean "no data," "still loading," "backend down," or "stream disconnected" — and the operator can't tell. They lose trust and fall back to curl, defeating the project's core value.

**Why it happens:**
- Streaming/async UIs are demoed on the happy path; empty/error/loading/disconnected are afterthoughts.
- SSE adds a state REST UIs lack: **connected-but-no-events-yet** and **disconnected-mid-stream**, which are easy to omit.
- A backend being down is normal in an ops tool, not exceptional.

**How to avoid:**
- For every streaming/data view, design **five** states explicitly: loading, empty, populated, error, and (for SSE) disconnected/reconnecting. Make them visually distinct.
- Surface stream connection status (connecting / live / disconnected) as first-class UI, with a manual retry.
- Distinguish "backend unreachable" from "no data" — tie into the health/observability surface.

**Warning signs:**
- Blank panels with no explanation.
- No visible difference between "loading," "empty," and "backend down."
- No way to tell if a stream is still live.

**Phase to address:** Establish the state pattern in **P3**, enforce it across **P4/P5**; connection-status + health in **P6**.

---

### Pitfall 11: Premature scope expansion — DAG editor, full dashboards (explicitly out of scope)

**What goes wrong:**
Effort sinks into a graphical drag-and-drop flow/DAG builder or full metrics dashboards before the read/run/stream path proves valuable. These are large, and PROJECT.md explicitly defers/excludes them ("visual DAG editor" deferred; "Replacing Grafana" out of scope; Grafana/OTEL already ship). The console ships late or never reaches its actual core value.

**Why it happens:**
- A DAG editor is the "exciting" feature and looks impressive in demos.
- "While we're at it, let's build metrics dashboards" — re-creating Grafana.
- Scope creep disguised as completeness.

**How to avoid:**
- Hold the line on PROJECT.md's Out-of-Scope: v1 **edits flow JSON** and **visualizes runs** — no graphical builder.
- Health/observability is **top-line health only** (`/healthz`/`/readyz` + surface gateway `/metrics`), explicitly *not* dashboards — link out to Grafana.
- Treat any DAG-editor / dashboard work as a separate future milestone gated on the read/run path proving valuable.

**Warning signs:**
- Roadmap phases for a visual graph editor or charting library before the SSE run viewer works.
- "Let's also build a metrics dashboard" in planning.
- Frontend graph/charting deps appearing early.

**Phase to address:** **Roadmap creation** — keep these out of v1 phases entirely; revisit only post-v1.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Generic pass-through `ReverseProxy` for all 3 backends | Fast to wire all routes | Confused-deputy/SSRF + header-spoofing; hard to retrofit allowlisting | **Never** — start with explicit mapped routes |
| Pass flowd token to browser so EventSource "just works" | Skip the cookie/session plumbing | Token leak = security model gone | **Never** — same-origin cookie + server-side injection from the start |
| Live SSE only, skip `/runs/{id}/events` + replay | Ship the run viewer sooner | Late joiners/reconnects show gaps; rework to add hydrate+dedupe | Only for a throwaway P2 streaming proof, not P4 |
| No heartbeat on SSE | Less code | Long runs die at proxy idle timeout | Never for production; OK only in the localhost proof |
| Unbounded event arrays in component state | Trivial to write | Tab memory blowup on long runs | OK for early prototype with short runs; fix before P4 ships |
| Optimistic CRUD with no rollback | Snappy UI | Operators see false state; trust loss | Only with confirmed rollback+refetch wired in |
| Global short server WriteTimeout applied to all routes | One config | Silently truncates streams | Never on SSE routes; exempt them explicitly |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| memory-gateway (`X-Tenant-Id`/`X-User-Id` auth) | Forward client-supplied scope headers | Strip inbound scope headers; set them server-side from operator context |
| flowd (bearer + SSE) | Token in browser / SSE URL; rely on EventSource resume | Token server-side only; bridge `/runs/{id}/replay` + `/events` for catch-up |
| flowd replay | Assume `Last-Event-ID` auto-replay works on the live stream | flowd uses a *separate* replay endpoint — BFF must call it and dedupe |
| customer-support chat (no auth, IP rate-limited) | Treat it like the others; ignore rate limits; expect replay | No replay endpoint — persisted turns are authoritative, streaming delta is ephemeral; respect IP rate limits via the BFF |
| All SSE upstreams via BFF | `io.Copy` through a buffering writer | Copy-and-flush per event; assert `http.Flusher`; `X-Accel-Buffering: no` |
| nginx/ingress in front of BFF | Default `proxy_buffering on`, `gzip on` | `proxy_buffering off`, no gzip, raised read timeout on SSE locations |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded DOM/state for stream logs | Tab memory climbs, scroll jank | Virtualize + ring-buffer + batch updates | Long runs / token-level chat (hundreds–thousands of events) |
| One re-render per SSE event | Frame drops at high event rate | Coalesce events per animation frame | High-frequency token streaming |
| Re-cloning huge event arrays per event | CPU spikes mid-run | Bounded/append-optimized structure | Runs with thousands of events |
| Reconnect storm on outage | Backend request spike during downtime | Client backoff + cap + `close()` | Any backend/BFF outage with multiple open tabs |
| Re-fetching full run history on every minor update | Latency + backend load | Snapshot once, then stream incrementally | Frequent UI refreshes of active runs |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| flowd bearer token reaches browser (JS, URL, log) | Direct unauthenticated access to flowd | Token in BFF env only; injected on upstream hop; grep gate on responses/bundle |
| Forwarding client `X-Tenant-Id`/`X-User-Id` to gateway | Tenant/user impersonation (gateway has no other auth) | Strip inbound; set scope server-side from operator context |
| Generic proxy taking target from client input | SSRF to internal services | Allowlist explicit mapped routes; pin upstream hosts in config |
| Token in SSE query string | Leaks into proxy/access logs | Use same-origin session cookie for browser→BFF auth |
| Logging full request headers on SSE routes | Secret leakage to logs | Redact/strip auth headers from SSE-route logging |
| No operator auth on the BFF itself | Anyone on the network operates all 3 backends | BFF holds operator-side credential/session (PROJECT.md: "BFF holds operator-side credentials") — don't skip it |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Blank panel for loading/empty/down | Operator can't diagnose; falls back to curl | Distinct loading / empty / error / disconnected states |
| No stream connection indicator | Operator unsure if data is live or frozen | First-class connecting/live/disconnected status + manual retry |
| Silent infinite reconnect | UI "frozen," no signal | Surface disconnect after N retries with explicit retry CTA |
| Optimistic CRUD with no failure feedback | Operator believes a false state | Rollback + toast on error; refetch affected item |
| Late-join run shows partial history with no note | Looks like data loss / broken console | Hydrate from `/events` first; indicate "caught up to live" |

## "Looks Done But Isn't" Checklist

- [ ] **SSE streaming:** Verify it streams **through a real proxy with compression on**, not just localhost — `curl -N` *and* browser, with gzip enabled upstream.
- [ ] **Long runs:** Verify a >2min run with quiet periods doesn't get cut by idle timeout — confirm heartbeat is flowing.
- [ ] **Reconnect:** Verify a forced BFF restart mid-run reconnects, catches up via replay/events, and **dedupes** (no duplicate or missing events).
- [ ] **Finished run:** Verify EventSource does **not** keep reconnecting to a completed run (explicit `done`/`end` + client `close()`).
- [ ] **Token secrecy:** Grep browser bundle + all BFF responses + logs for the flowd token — must be absent.
- [ ] **Scope headers:** Verify client-supplied `X-Tenant-Id` is ignored/stripped, not trusted.
- [ ] **Long log:** Verify a thousand-event run doesn't blow up tab memory or jank scrolling.
- [ ] **CRUD failure:** Verify a rejected memory mutation rolls back the UI and shows an error.
- [ ] **Backend down:** Verify each console clearly shows "backend unreachable," distinct from "no data."

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| SSE buffered by proxy | LOW–MEDIUM | Add `X-Accel-Buffering: no` + per-event flush + disable gzip on SSE routes; fix proxy buffering config |
| Long runs cut by timeout | LOW | Add heartbeat emitter; raise/disable read timeout on SSE routes |
| Reconnect storm | LOW | Add client backoff/cap + `close()` on terminal/`done` |
| Late joiners miss events | MEDIUM | Wire hydrate-from-`/events`/replay + dedupe by event id |
| Token leaked to browser | HIGH | Rotate `FLOWD_TOKEN`; remove from client path; move auth to same-origin cookie; audit logs |
| Confused-deputy/SSRF proxy | HIGH | Replace pass-through with allowlisted mapped routes; strip/set scope headers server-side |
| Unbounded DOM/memory | MEDIUM | Introduce virtualization + bounded buffer; refactor list component |
| REST/SSE race | MEDIUM | Introduce sequence-keyed reconciliation; snapshot-then-stream handoff |
| Optimistic CRUD desync | LOW–MEDIUM | Add rollback + refetch-after-mutate |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| SSE proxy buffering | P2 (SSE path) | `curl -N` + browser stream live through proxy with gzip on |
| Idle-timeout kills long runs | P2 | >2min quiet-period run completes on screen; heartbeat visible |
| Reconnect storm | P2 (signaling) + P4/P5 (client backoff) | Finished run stops reconnecting; outage backs off |
| Late joiners lose events | P4 (Flow console) | In-progress open + reconnect catch up with no gaps/dupes |
| Bearer token leak | P1 (BFF) | Grep bundle/responses/logs — token absent |
| Confused-deputy/SSRF + header spoof | P1 (BFF) | Client scope headers ignored; no client-controlled upstream target |
| Unbounded stream logs | P4/P5 | Thousand-event run: stable memory, smooth scroll |
| REST/SSE race | P4 | Repeated refresh shows consistent ordered events |
| Optimistic CRUD desync | P3 (Memory console) | Rejected mutation rolls back + errors |
| Poor empty/error/loading/disconnected states | P3 (pattern) → P4/P5 (enforce) → P6 (health) | Five distinct states present per view |
| Premature DAG editor / dashboards | Roadmap creation | No graph-editor/charting phases in v1; Grafana linked out |

## Sources

- MDN — Using server-sent events (EventSource auto-reconnect, `Last-Event-ID`, `id` field): https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- WHATWG HTML issue #2177 — Setting headers for EventSource (confirms EventSource cannot set custom headers): https://github.com/whatwg/html/issues/2177
- OneUptime — Configuring Server-Sent Events Through Nginx (`proxy_buffering off`, `X-Accel-Buffering: no`, gzip off, timeouts): https://oneuptime.com/blog/post/2025-12-16-server-sent-events-nginx/view
- CodeToDeploy — SSE Behind Nginx/YARP: buffering, timeouts, compression defaults that break streaming: https://medium.com/codetodeploy/net-10-sse-in-production-the-3-reverse-proxy-defaults-that-make-real-time-not-real-time-9c1a6d1c5622
- gin-gonic/gin issue #1589 — SSE buffered by nginx (real-world failure + flush requirement): https://github.com/gin-gonic/gin/issues/1589
- HireNodeJS — Node.js SSE production guide 2026 (cookie vs query-token vs fetch auth patterns; token-in-URL leaks to logs): https://www.hirenodejs.com/blog/nodejs-server-sent-events-sse-2026
- HAHWUL — Securing SSE (auth patterns, header limitations): https://www.hahwul.com/sec/web-security/sse/
- Project context: `.planning/PROJECT.md` (three backends, auth models, explicit Out-of-Scope: DAG editor, Grafana replacement)

---
*Pitfalls research for: internal admin/ops console + single-origin BFF with SSE over heterogeneous-auth backends*
*Researched: 2026-06-03*
