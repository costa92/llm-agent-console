# Phase 2: Memory Console - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 delivers the **Memory Console** — the first feature slice, deliberately REST-only (no SSE) to prove **operator-context auth injection + TanStack Query caching** before the keystone streaming phase. An operator can:

- **Recall/search** memory against the gateway (`POST /memory/recall/unified`) and see ranked results with score + metadata.
- **Open an item detail** (`GET /memory/items/{id}`) with rendered fields + raw JSON.
- **Write** a new record (`POST /memory/write`) and **patch** an existing one (`PATCH /memory/items/{id}`) via a validated JSON editor.
- Run the lifecycle: **pin/unpin** (`POST .../pin|unpin`), **disable/enable** (`POST .../disable|enable`), **delete** (`DELETE /memory/items/{id}`) — with pessimistic UI and confirm-on-destructive.
- All gated behind operator context (`X-Console-Tenant`/`X-Console-User` → re-materialized as gateway `X-Tenant-Id`/`X-User-Id` server-side by the BFF).

Covers REQ **MEM-01..08**.

**NOT in this phase:**
- **Session close/heartbeat** (`POST /memory/sessions/{id}/close|heartbeat`) — deferred to v2 per PROJECT.md: there is no read endpoint to *view* session state, so v1 surfaces no session-state view.
- SSE / streaming anything (Flow=Phase 3, Chat=Phase 4).
- Live service health polling (SHELL-02 = Phase 5).

**Substrate is locked by Phase 1** (foundation slice): operator-context bar + `X-Console-*` injection, the five-state pattern, app-wide toast, raw-JSON viewer, copyable-id, the destructive-dialog pattern, TanStack Query cache, `@tanstack/react-table`, `react-hook-form`+`zod`. This discussion settled how the Memory Console consumes that substrate.

</domain>

<decisions>
## Implementation Decisions

### Search & results layout
- **D-01:** **Advanced filters + data-table.** Results render in a `@tanstack/react-table` data-table (reusing the Phase 1 stack) with score-rank as the default order. The search controls expose **query + top-k + score-threshold + metadata filters** (not just a bare query box).
- **D-02:** **Collapsible advanced panel.** Query box + top-k are always visible; score-threshold + metadata filters live behind an "Advanced" toggle. **All filter state lives in URL search params** (TanStack Router) so a search is reproducible and shareable.
- **D-03 (research-gated):** **Server re-query on sort/page** is the intended behavior — each sort/page change re-POSTs `recall/unified` with sort/offset params. **This is conditional on the gateway recall endpoint actually accepting sort/offset params (UNCONFIRMED).** If research finds the endpoint does NOT support server-side sort/offset, **fall back to client-side sort/paging over the returned top-k** (fetch top-k once; raise top-k to pull more). Research MUST confirm the recall request schema before the planner locks this.

### Item detail & action placement
- **D-04:** **Side-drawer detail, not a full route.** Opening an item slides a drawer in over the results list (list stays visible behind) showing rendered fields + the Phase 1 raw-JSON viewer + all lifecycle actions. Chosen over a full route for fast back-and-forth across many items.
- **D-05:** **Sync the open item to a URL search param** (e.g. `?item={id}`, TanStack Router). Reload reopens the drawer, the link is shareable, browser-back closes it — recovering most of the deep-link value given up by choosing drawer over a full route.
- **D-06:** **Row quick-actions.** Result rows carry a compact action menu (pin/disable/delete) for fast triage without opening the drawer; the drawer also exposes the full action set + patch.

### Write / patch editor
- **D-07:** **Raw JSON editor + zod validation**, mono font (consistent with the Phase 1 raw-JSON viewer), with inline parse/validation error feedback before submit. Chosen for flexibility against the gateway's freeform record shape; the planner adds a thin zod schema. **Patch pre-fills current item JSON; write starts blank/templated.**
- **D-08:** **One editor, two modes.** A **"New record" button** on the Memory page opens the *same* drawer editor used for patch (write mode = blank/templated, patch mode = pre-filled). No separate create route — one editor component to build and keep consistent.

### Lifecycle safety & cache
- **D-09:** **Reflect-from-response, no auto re-search.** After a successful mutation, update the affected item **in place from the mutation response** (`queryClient.setQueryData`); **delete removes the row locally**. Do **NOT** auto-re-run recall — search is operator-initiated. A manual "refresh search" affordance stays available.
  - **Research note:** this assumes the pin/unpin/disable/enable/patch endpoints return the updated item in the response. If any return only a status (no body), the planner falls back to a **single-item refetch** (`GET /memory/items/{id}`) for that action rather than a full recall re-run.
- **D-10:** **Confirm weight differs by reversibility.** Both delete and disable require confirmation (locked by ROADMAP), but: **delete** uses the Phase 1 **red destructive dialog** (repeats "Delete", states irreversibility); **disable** uses a **lighter neutral confirm** ("Disable this item?" — reversible, no red). Reserves destructive-red for the truly irreversible, honoring the UI-SPEC's restrained accent/destructive budget. pin/unpin/enable are non-destructive → no confirm.
- **D-11 (pessimistic UI — locked by ROADMAP):** state reflects **only after** the backend confirms — the acted item shows a pending/disabled treatment during the round-trip; no optimistic flip-then-revert.

### Operator-context gating (MEM-08)
- **D-12:** **Full-page block when context is unset.** When tenant/user is unset (every gateway call requires `X-Tenant-Id` + `X-User-Id`), the entire Memory console is replaced by the Phase 1 **"No operator context set"** empty-state + a "Set context" affordance pointing at the operator-context bar. No dead controls, no doomed requests. Consistent with the amber "unusable" treatment already in the shell.

### Lifecycle state visibility
- **D-13 (partly research-gated):** **Pinned/disabled badges in the table + filter by them.** Each result row shows pinned/disabled as color-safe status badges (icon+text per UI-SPEC), and the advanced filter panel can filter by pinned/disabled **IF `recall/unified` returns and accepts those fields**. **Fallback:** if recall returns the state but can't filter on it → badges only (display, no filter); if recall doesn't return lifecycle state at all → state shows in the drawer detail only. Research MUST confirm which fields recall returns.

### Claude's Discretion
- Exact API route prefix/namespacing under the BFF (e.g. `/api/memory/*`) — set in Phase 1; reuse as built.
- Toast copy specifics for each memory action — follow the Phase 1 UI-SPEC copywriting contract (`{action} failed — {status}: {upstream message}` + Copy error; success terse past-tense).
- Table column selection and detail field rendering — driven by the recall/item response schema (research) + the UI-SPEC mono/id/timestamp conventions.
- zod schema shape for the JSON editor — planner derives from the gateway write/patch contract.
- Empty-state (valid search, zero results) vs error-state wording — per the five-state pattern; distinct from the D-12 unset-context gate.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project specs (locked)
- `.planning/PROJECT.md` — locked decisions + the **verified memory-gateway route + auth inventory** (`POST /memory/recall/unified`, `POST /memory/write`, `PATCH /memory/items/{id}`, `POST .../pin|unpin|disable|enable`, `DELETE /memory/items/{id}`, `GET /memory/items/{id}`; auth = required `X-Tenant-Id` + `X-User-Id`, optional `X-Project-Id`/`X-Session-Id`). Note: session close/heartbeat is v2-deferred.
- `.planning/REQUIREMENTS.md` — this phase's requirements MEM-01..08.
- `.planning/ROADMAP.md` §"Phase 2: Memory Console" — goal + 5 success criteria (ranked results w/ score+metadata, validated JSON editor, pessimistic UI, confirm-on-destructive, context gating).

### Design contract (APPROVED — MUST follow for any UI)
- `.planning/phases/01-foundation/01-UI-SPEC.md` — the approved design system: five-state pattern, toast contract, raw-JSON viewer, copyable-id, **destructive-dialog pattern** (reused by D-10), color/typography/spacing tokens, dark-first operator aesthetic. The Memory Console consumes these — does not redefine them.

### Phase 1 foundation (build ON this — do not re-create)
- `.planning/phases/01-foundation/01-CONTEXT.md` — the operator-context model: `X-Console-*` → gateway `X-Tenant-Id`/`X-User-Id` re-materialization (D-01/D-07 there), localStorage for non-secret context, the BFF auth boundary. MEM auth injection rides entirely on this.

### Research (locked stack + pitfalls)
- `.planning/research/STACK.md` — LOCKED stack: React 19 + Vite, TanStack Query/Router, `@tanstack/react-table`, shadcn/ui, Tailwind v4, `react-hook-form`+`zod`, sonner. (No SSE client needed this phase — REST-only.)
- `.planning/research/ARCHITECTURE.md` — BFF boundary (one director per upstream), REST-vs-SSE split, vertical-slice build order.
- `.planning/research/PITFALLS.md` — BFF auth boundary: strip inbound `X-*-Id`/`Authorization`, re-materialize gateway scope server-side; allowlist mapped routes (no SSRF/confused-deputy).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **From Phase 1 (built, not yet executed at discussion time):** operator-context bar + `X-Console-*` header plumbing, `FiveStateWrapper`, `RawJsonViewer`, `CopyableId`, app-wide toast (sonner), the destructive-dialog pattern, the BFF directors + operator-token middleware, `/api/config/env`. Phase 2 **consumes** these; it must not re-create them.
- **Stack libraries already chosen:** `@tanstack/react-table` (results table), `@tanstack/react-query` (cache + mutations + `setQueryData`), `@tanstack/react-router` (URL search-param state for filters D-02 and drawer item D-05), `react-hook-form`+`zod` (editor validation D-07).

### Established Patterns
- **Five-state pattern is mandatory per view** (loading/empty/error/partial/ready) — the recall results, the item detail drawer, and each mutation surface must implement it.
- **Pessimistic UI** (D-11) and **confirm-on-destructive** (D-10) are the lifecycle interaction patterns; Phase 1 supplies the destructive-dialog component.
- **Single-origin BFF**: the SPA calls same-origin `/api/memory/*`; the BFF injects gateway scope. No direct browser→gateway calls, no CORS.

### Integration Points
- **memory-gateway** (`:8080`) over HTTP at the BFF-configured URL — the BFF does NOT import gateway Go packages. Route + auth contract is fixed (PROJECT.md).
- This is the **first feature slice** to exercise the Phase 1 auth-injection + query-cache path end-to-end against a real backend — it validates that substrate before Phase 3's SSE keystone.

</code_context>

<specifics>
## Specific Ideas

- **Two research-gated decisions the planner must resolve against the real recall schema BEFORE locking:**
  1. **D-03** — does `recall/unified` accept server-side sort/offset params? (Yes → server re-query; No → client-side sort over top-k.)
  2. **D-13** — does `recall/unified` return + filter on pinned/disabled state? (full badges+filters / badges-only / drawer-only fallback ladder.)
- **D-09 mutation-response shape** — confirm whether pin/unpin/disable/enable/patch return the updated item body (reflect-from-response) or just a status (single-item refetch fallback).
- The recall request/response schema, item record shape, and lifecycle-endpoint response shapes are **the central research targets** for this phase — most UI decisions above carry an explicit fallback keyed to what research finds.

</specifics>

<deferred>
## Deferred Ideas

- **Session close/heartbeat view** (`POST /memory/sessions/{id}/close|heartbeat`) — v2; no read endpoint exists to view session state, so no v1 UI (PROJECT.md).
- **Saved/named searches or recall history** — not raised as in-scope; a possible v1.x refinement of the URL-synced filter state (D-02).
- **Optimistic UI** — explicitly NOT chosen; ROADMAP locks pessimistic UI (D-11). Recorded in case latency makes optimistic-with-rollback desirable later.
- None of the above expand phase scope — they are deferrals/alternatives, not new capabilities.

</deferred>

---

*Phase: 02-memory-console*
*Context gathered: 2026-06-03*
