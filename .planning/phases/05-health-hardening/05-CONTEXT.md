# Phase 5: Health & Hardening - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 is the **cross-cutting hardening** phase (SHELL-02). It delivers:
- **Always-visible per-service health** (up/down/degraded) for memory-gateway, flowd, chat — polled on an interval with a last-checked timestamp, lighting the **existing Phase-1 shell HealthDots**.
- **Five-state contract enforced** across every area (loading/empty/error/partial/ready) — an audit + gap-fix of the Memory/Flow/Chat surfaces.
- The **SSE disconnected/reconnecting** state on stream views: **auto-reconnect with capped backoff + manual retry**, closing on the terminal `done` (no reconnect storms). This is the reconnect layer the Phase-3/4 connection-state machine was **designed to extend** into.

Covers REQ **SHELL-02**.

**NOT in this phase:**
- Deep metrics / Grafana replacement — the console surfaces only top-line health (PROJECT.md out-of-scope).
- New feature screens — this phase hardens the existing Memory/Flow/Chat surfaces.
- The compose/deploy verification of streaming — Phase 6.

**Health-endpoint facts (verified, PROJECT.md):** memory-gateway has **only `/metrics`** (NO `/healthz`/`/readyz`) → "up" = a cheap reachability probe; flowd has `/healthz` (open); customer-support has `/healthz` + `/readyz`. All auth-none for health.

</domain>

<decisions>
## Implementation Decisions

### Health probe architecture
- **D-01:** **BFF aggregate `/api/health`.** A new BFF endpoint server-side probes all three services (flowd `/healthz`, chat `/healthz`, memory-gateway via a cheap **reachability/`/metrics` probe** — research picks the exact mechanism) and returns `{service: up|down|degraded|unknown, lastChecked}` per service. The SPA polls **ONE** endpoint. Centralizes the memory special-case + keeps the SPA simple. (This is a small, scoped deviation from the pure-proxy BFF — a health handler, NOT a feature proxy.)
- **D-02:** **Cadence ~15s; states up / down / unknown (+ slow→degraded).** Poll every ~15s. **up** = probe 200; **down** = unreachable or non-2xx; **unknown** = pre-first-poll OR the `/api/health` call itself failed (stale — show last-checked); **degraded** (amber) only for a probe that succeeds but is **slow** (over a latency threshold — threshold is discretion). Lights the existing Phase-1 shell **HealthDots** (dot + status color + icon + last-checked) — reuse, don't rebuild the visual.

### SSE reconnect / backoff
- **D-03:** **Auto-reconnect with capped exponential backoff + jitter + manual retry.** On a **transport drop** (no terminal frame), auto-reconnect with **exponential backoff + jitter, capped** (exact attempts/max-delay = discretion, e.g. ~5 attempts / ~30s), showing a **"Reconnecting (n/N)…"** state; a **manual Retry** is always available; reconnection **STOPS on the terminal `done`/`error`** (no reconnect storms). Per-stream recovery:
  - **Flow runs:** reconnect **hydrates `GET /runs/{id}/events` + de-dups** on `(kind,node,ordinal)` (the Phase-3 `retry()` seam) — resumes without losing/duplicating events.
  - **Chat:** re-opens the stream.
  - This **extends** the Phase-3/4 `connection.ts` state machine (which was built to add `reconnecting` on top of streaming/closed/errored) — extend, do NOT rewrite. A flowd `flow_err` / chat `error` frame remains a terminal in-content error (NOT a transport drop → no reconnect).

### Five-state hardening
- **D-04:** **Audit + fix gaps + add disconnected/reconnecting.** Audit every existing Memory/Flow/Chat view against the five-state contract (loading/empty/error/partial/ready) and **fix any gaps found**, AND add the new SSE **disconnected/reconnecting** state on top for the stream views (flow timeline, chat). Most surfaces already use `FiveStateWrapper` (Phases 2-4) — this is a targeted, evidence-driven retrofit, not a rewrite.

### Claude's Discretion (+ research/planner-owned)
- The **memory-gateway reachability probe** mechanism (a `/metrics` scrape vs a minimal HEAD/GET) + per-service probe timeout + parallel-probe in the BFF handler — research/planner.
- The exact **reconnect cap** (attempts + max delay) + backoff base + jitter formula — planner/UI-SPEC.
- The **"slow" latency threshold** for degraded — discretion.
- Whether polling pauses on a hidden tab (visibility) — discretion.
- The `/api/health` allowlist wiring in the BFF (it's a BFF-owned route, not an upstream proxy) — planner.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project specs (locked)
- `.planning/PROJECT.md` — the per-service health-endpoint inventory (memory-gateway `/metrics` only — no `/healthz`; flowd `/healthz` open; customer-support `/healthz`+`/readyz`; all auth-none) + the "top-line health only, not Grafana" boundary.
- `.planning/REQUIREMENTS.md` — SHELL-02.
- `.planning/ROADMAP.md` §"Phase 5: Health & Hardening" — goal + 3 success criteria.

### Phase 1 substrate (extend — do not re-create)
- `web/src/components/shell/HealthDot.tsx` + `TopBar.tsx` (executed) — the HealthDot VISUAL contract + the `unknown` initial state. Phase 1 shipped the dot; THIS phase wires live polling into it.
- `.planning/phases/01-foundation/01-03-SUMMARY.md` — the BFF (where the new `/api/health` handler lives; the director allowlist pattern).
- `.planning/phases/01-foundation/01-UI-SPEC.md` — the status `--status-*` tokens (up green / degraded amber / down red / unknown slate) + the five-state contract.

### Phase 3/4 substrate (extend the connection machine)
- `web/src/features/flow/timeline/connection.ts` (executed) — the connection-state machine to EXTEND with `reconnecting` (streaming/closed/errored → + reconnecting). The Phase-3 `useRunStream.retry()` = `/events`-hydrate+de-dup is the flow reconnect seam.
- `web/src/features/chat/turns/useChatStream.ts` (executed) — the chat stream hook (re-open on reconnect).
- `.planning/phases/03-flow-console/03-RESEARCH.md` + `04-RESEARCH.md` — the de-dup + abort + connection-machine contracts reconnect builds on.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 1 (executed):** `HealthDot`/`TopBar` shell dots (visual + unknown state — add polling), the BFF (add the `/api/health` handler).
- **Phase 3/4 (executed):** `connection.ts` machine (extend with reconnecting), `useRunStream.retry()` (flow `/events`-hydrate+de-dup reconnect seam), `useChatStream` (chat re-open), `FiveStateWrapper`, `ConnectionBadge`.

### Established Patterns
- The connection-state machine was explicitly **designed to extend** (Phase 3/4 added streaming/closed/errored; this phase adds reconnecting). Extend, don't rewrite.
- Health polling is a REST interval poll (TanStack Query `refetchInterval`) — NOT a stream.
- Reconnect must STOP on terminal (no storms); a content error frame (flow_err/chat error) is NOT a transport drop.

### Integration Points
- The new BFF `/api/health` probes flowd `:7861/healthz`, chat `:8080/healthz`, memory-gateway `:8080/metrics`-reachability over HTTP at the configured URLs (auth-none). It's a BFF-owned route (not a proxied upstream feature route).
- This phase touches ALL three feature surfaces (the five-state audit) + the shell (health) + the stream hooks (reconnect) — the most cross-cutting phase.

</code_context>

<specifics>
## Specific Ideas

- **Research targets the planner must resolve:**
  1. The memory-gateway **reachability probe** — `/metrics` is a Prometheus text scrape, not a clean up/down JSON; confirm the cheapest probe that yields a reliable up/down (a 200 on `/metrics`, or a minimal request) without parsing metrics.
  2. The BFF `/api/health` handler shape — parallel probes with per-service timeouts; the up/down/degraded mapping (degraded = slow over threshold); the response DTO the SPA consumes.
  3. How reconnect composes with the Phase-3 `retry()` (flow) vs a fresh open (chat) inside the extended `connection.ts` — keep the de-dup invariant.
- The reconnect layer must be unit-testable WITHOUT a live backend (reuse the Phase-3/4 fake SSE emitter — script a drop then a successful reconnect, assert the `reconnecting (n/N)` progression + the cap + stop-on-terminal).

</specifics>

<deferred>
## Deferred Ideas

- **Deep metrics / Grafana-style dashboards** — PROJECT.md out-of-scope; top-line health only.
- **A degraded tier from `/readyz`** — NOT chosen (D-02 uses slow-probe for degraded, not readyz); recorded as a possible richer signal later.
- **Per-stream reconnect tuning UI** (operator-configurable backoff) — not in scope; the cap is fixed.
- None of the above expand phase scope.

</deferred>

---

*Phase: 05-health-hardening*
*Context gathered: 2026-06-04*
