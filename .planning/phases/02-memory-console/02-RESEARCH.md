# Phase 2: Memory Console - Research

**Researched:** 2026-06-03
**Domain:** React 19 SPA feature slice (recall + CRUD + lifecycle) over a fixed Go memory-gateway contract, through a single-origin Go BFF; TanStack Query/Router state.
**Confidence:** HIGH — the entire gateway contract was read from source (`../llm-agent-memory-gateway/internal/{transport,httpapi,authz,service}`) plus golden wire-test JSON. All three research-gated decisions are resolved against real code, not training data.

## Summary

This phase is gated almost entirely by **the gateway's fixed wire contract**, which I read directly from source. The headline findings collapse several open decisions to a single forced answer:

1. **D-03 (sort/page): the recall endpoint supports NEITHER server-side sort NOR offset/pagination.** `POST /memory/recall/unified` takes `query` + `top_k` (capped at 50) and returns a flat `hits[]` already ranked by `score` descending. There is no `sort`, `offset`, `page`, `cursor`, or `total` field anywhere in the request or response. **The plan MUST take the client-side fallback path:** fetch top-k once, sort/page client-side over the returned hits, and raise `top_k` (≤50) to pull more. `@tanstack/react-table`'s client-side sort/pagination model is the right fit.

2. **D-13 (lifecycle state visibility): recall RETURNS `pinned` and `disabled` booleans on every hit, but CANNOT filter on them** (no request params accept them). So the fallback ladder lands at **badges-yes / server-filter-no**: render pinned/disabled badges per row from the recall response, and any pinned/disabled filtering is **client-side** over the fetched hits (consistent with the D-03 client-side path). The drawer also shows them (GET item returns both).

3. **D-09 (reflect-from-response): mutation responses are LEAN — they return `{memory_id, version, <flag>}`, NOT the full updated item.** Patch/write return even less (`{memory_id, version}` and `{memory_id, version, status}`). So `setQueryData`-from-response can only update the **version + the one toggled flag** — it cannot refresh `content`/`tags`/`category`. **The plan should fall back to a single-item refetch (`GET /memory/items/{id}`) after patch and write** to get the authoritative body, and may optimistically merge the flag for pin/unpin/disable/enable from their responses (which do echo the flag). Delete returns `{deleted, version}` → remove the row locally.

The fourth, larger finding the planner MUST design around: **every lifecycle mutation is optimistic-concurrency-gated on `expected_version`** (required, `> 0`, or the gateway returns `400 bad_request "expected_version is required"`; a stale version returns `409 memory_conflict`). The console therefore must always carry the current `version` of each item (recall hits and GET both include it) and send it as `expected_version`. A `409 memory_conflict` is a first-class, expected error state (item changed under you) — the five-state error path must surface it and the recovery is "refetch the item, retry with the new version."

**Primary recommendation:** Build three vertical slices — (A) recall→table render, (B) item drawer detail, (C) lifecycle mutations — over a thin typed `/api/memory/*` client. Treat `version` as load-bearing throughout. Use client-side table sort/page (D-03 forced), badges-from-recall + client-side state filter (D-13 forced), and refetch-after-patch/write while flag-mutations reflect-from-response (D-09 hybrid). Send `scope: {}` in request bodies — the BFF-injected `X-Tenant-Id`/`X-User-Id` headers are authoritative and override any body scope.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Recall query + ranked results | API (gateway) | Frontend (render) | Gateway owns scoring/ranking; SPA only renders the returned order |
| Sort / paginate results | Browser (client) | — | Gateway returns flat top-k with no sort/offset params (verified) — sorting/paging is purely client-side over fetched hits |
| Filter by pinned/disabled | Browser (client) | — | Recall returns the flags but accepts no filter params (verified) — filtering is client-side |
| Auth scope injection | API/BFF (server) | — | BFF re-materializes `X-Console-*` → gateway `X-Tenant-Id`/`X-User-Id`; never client-trusted (Phase 1, BFF-02) |
| Operator-context gating | Browser (client) | — | SPA blocks the whole console when tenant/user unset (MEM-08, D-12); avoids doomed requests |
| Optimistic-concurrency (`expected_version`) | API (gateway) | Browser (carry version) | Gateway enforces version match; SPA must carry + send current version |
| Mutation cache reflection | Browser (TanStack Query) | API (refetch) | `setQueryData` for flag toggles; refetch GET item for patch/write body |
| JSON validation (write/patch) | Browser (zod) | API (authoritative) | Client zod gives fast feedback; gateway is the authoritative validator (kind/content/version rules) |

## Standard Stack

This phase introduces **no new packages** — the stack is LOCKED by Phase-1 research (PROJECT.md ## Technology Stack) and consumed as built. Everything below is already a project dependency.

### Core (already installed — reused, not added)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react / react-dom | 19.2.x | UI | Locked stack [CITED: PROJECT.md] |
| @tanstack/react-query | 5.101.x | Recall cache, item-detail cache, mutations + `setQueryData`/`invalidateQueries` | Standard for REST-over-HTTP admin CRUD [CITED: PROJECT.md] |
| @tanstack/react-router | 1.170.x | URL search-param state for filters (D-02) and open drawer item `?item={id}` (D-05) | Type-safe search params [CITED: PROJECT.md] |
| @tanstack/react-table | 8.21.x | Results data-table with **client-side** sort + pagination (D-01/D-03) | Headless table; client model fits the no-server-sort reality [CITED: PROJECT.md] |
| react-hook-form | 7.77.x | Write/patch editor form state (D-07/D-08) | Pairs with zod resolver [CITED: PROJECT.md] |
| zod | 4.4.x | Validate the raw-JSON editor before submit (D-07); narrow BFF responses | Runtime schema validation [CITED: PROJECT.md] |
| shadcn/ui | CLI 3.x | drawer/sheet, dialog (destructive + neutral confirm), badge, dropdown-menu (row actions), table primitives | Owned components, Phase-1 design system [CITED: 01-UI-SPEC.md] |
| sonner | 2.0.x | Per-action toast feedback (SHELL-06 contract) | App-wide toast, built Phase 1 [CITED: 01-UI-SPEC.md] |

### Supporting (verify availability — see note)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| shadcn `sheet` (drawer) | shadcn registry | Side-drawer item detail (D-04) over the results list | The detail surface; slides over, list stays visible |
| shadcn `dropdown-menu` | shadcn registry | Row quick-actions menu (D-06) | Compact per-row pin/disable/delete |

**Note on the drawer component:** shadcn ships **`sheet`** (Radix Dialog-based slide-over) as its drawer-over-content primitive; the separate shadcn **`drawer`** block is Vaul-based and bottom-sheet-oriented (mobile). For a desktop operator console, **`sheet`** is the correct primitive for D-04. [ASSUMED — confirm the exact block name when the planner runs `npx shadcn add`; both are official-registry blocks so no registry-safety gate applies per 01-UI-SPEC Registry Safety.]

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Client-side table sort/page | Server sort/page | **Not available** — gateway has no sort/offset params (verified). Not a choice. |
| `setQueryData` from mutation response (full) | refetch GET item | Forced hybrid: flag-toggles echo their flag (can merge); patch/write return only `{memory_id, version}` → must refetch for body. |
| zod raw-JSON editor (D-07) | structured react-hook-form fields | Locked to raw-JSON by D-07 for flexibility against the freeform record; zod schema is thin and derivable from `WriteRecordPayload`/`PatchMemoryFields` below. |

**Installation:** None. No `npm install` for this phase beyond any shadcn blocks added via `npx shadcn add sheet badge dropdown-menu dialog` (these copy code into the repo; they are not npm runtime deps).

## Package Legitimacy Audit

**Not applicable — this phase installs no external packages.** All runtime dependencies were vetted and locked in Phase-1 research (PROJECT.md ## Sources cite `npm view` verification 2026-06-03). shadcn blocks added this phase (`sheet`, `badge`, `dropdown-menu`, `dialog`) are copy-in code from the **official** shadcn registry — per 01-UI-SPEC ## Registry Safety, the official registry triggers no vetting gate. No new npm packages enter `package.json`.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MEM-01 | Recall/search; ranked results w/ score + metadata; each links to detail | Recall contract below: `hits[]` with `score`, `metadata.{matched_by,token_cost_estimate}`, `memory_id`. Ranked by score desc. Client-side table (D-03 forced). |
| MEM-02 | Item detail (`GET /memory/items/{id}`) rendered fields + raw JSON | `GetMemoryItemResponse` shape below (drawer detail D-04); raw-JSON viewer is a Phase-1 primitive. |
| MEM-03 | Write new record (`POST /memory/write`) via validated JSON editor | `WriteMemoryRequest`/`WriteRecordPayload` schema below; gateway-enforced rules (idempotency_key required, content required, kind ∈ {working,episodic,semantic}). |
| MEM-04 | Patch item (`PATCH /memory/items/{id}`) | `PatchMemoryRequest`/`PatchMemoryFields` (all optional pointers); `expected_version` required. |
| MEM-05 | Pin/unpin (`POST .../pin|unpin`) | `PinMemoryRequest`→`PinMemoryResponse{memory_id,version,pinned}`; `expected_version` required; non-destructive (no confirm). |
| MEM-06 | Disable/enable (`POST .../disable|enable`) | `DisableMemoryRequest`→`DisableMemoryResponse{memory_id,version,disabled}`; `expected_version` required; disable=neutral confirm (D-10). |
| MEM-07 | Delete (`DELETE /memory/items/{id}`); delete+disable confirm; pessimistic | `DeleteMemoryRequest{expected_version}`→`{memory_id,deleted,version}`; red destructive dialog (D-10); pessimistic reflect-after-confirm (D-11). |
| MEM-08 | All actions gated behind operator context | Gateway requires `X-Tenant-Id`+`X-User-Id` (authz/scope.go); full-page block when unset (D-12); reuses Phase-1 context bar amber-unusable treatment. |
</phase_requirements>

---

## THE GATEWAY CONTRACT (verified from source — the central research target)

> Source files (all read this session, gateway must NOT be modified):
> `internal/transport/router.go`, `internal/transport/*_handler.go`, `internal/transport/middleware.go`,
> `internal/httpapi/types.go`, `internal/httpapi/errors.go`, `internal/authz/scope.go`,
> `internal/service/service.go`, and golden wire JSON in `internal/httpapi/testdata/wire/*.json`.

### Routes (exact, from `router.go`) [VERIFIED: gateway router.go]
```
POST   /memory/recall/unified
POST   /memory/write
PATCH  /memory/items/{memory_id}
POST   /memory/items/{memory_id}/pin
POST   /memory/items/{memory_id}/unpin
POST   /memory/items/{memory_id}/disable
POST   /memory/items/{memory_id}/enable
DELETE /memory/items/{memory_id}
GET    /memory/items/{memory_id}
POST   /memory/sessions/{session_id}/close       ← v2-deferred, NOT this phase
POST   /memory/sessions/{session_id}/heartbeat   ← v2-deferred, NOT this phase
```
The path param is `memory_id`. The BFF maps the console's same-origin `/api/memory/*` prefix to these (D Claude's-discretion / Phase-1; reuse as built). All write methods (POST/PATCH/DELETE) **require `Content-Type: application/json`** or the gateway returns `400 bad_request "Content-Type must be application/json"` (`middleware.go::EnsureJSONRequest`). The BFF passes the header through; the console's fetch client must set it on every mutating call (including DELETE, which carries a body here).

### Auth scope (from `authz/scope.go` + `service.go::mergeScope`) [VERIFIED: gateway authz/scope.go]
- Gateway reads scope from **headers**: `X-Tenant-Id` (required), `X-User-Id` (required), `X-Project-Id` (optional), `X-Session-Id` (optional). Missing tenant or user → `401 unauthorized "missing or invalid auth scope headers"`.
- Request bodies also carry a `scope` object (`tenant_id`/`user_id`/`project_id`/`session_id`), BUT `MergeAuthoritativeScope` **forces the header tenant/user over the body's** (and overrides project/session if the header set them). **Implication for the console:** the BFF injects the authoritative headers from `X-Console-*`; the console can send `scope: {}` (empty) in every body — the body scope is ignored for tenant/user. Sending it empty avoids leaking/duplicating identity client-side and matches the Phase-1 boundary (identity is never client-trusted). [VERIFIED: gateway service.go::mergeScope + authz.MergeAuthoritativeScope]

### Error envelope (from `errors.go`) [VERIFIED: gateway errors.go]
Every non-2xx returns:
```json
{ "error": { "code": "...", "message": "...", "request_id": "...", "retryable": false, "details": { } } }
```
Status-code mapping (drives the five-state error UI + BFF pass-through per BFF-04):

| HTTP | `code` | Meaning for the console |
|------|--------|--------------------------|
| 400 | `bad_request` | bad payload / missing `expected_version` / `top_k>50` / bad Content-Type / `query` empty |
| 401 | `unauthorized` | scope headers missing → should be prevented by D-12 gate, but surface if it slips |
| 403 | `forbidden`, `session_expired` | session gating |
| 404 | `not_found` | unknown `memory_id`, or `recall backend is not configured` |
| 409 | `memory_conflict`, `idempotency_conflict` | **stale `expected_version`** (the load-bearing one) or replayed idempotency key with different payload |
| 503 | `read_only_mode` (retryable), `upstream_unavailable` (retryable) | gateway degraded |
| 500 | `internal_error` | fallback |

The console error-state component should render `{status} from memory-gateway — {error.message}` and disclose the full `error` object via the Phase-1 raw-JSON viewer (matches the 01-UI-SPEC error-state contract). The `error.details` map carries useful structured context — e.g. on a `memory_conflict` it includes `{memory_id, expected_version, current_version}` (see `error_response.json` golden), which the console can use to drive "refetch and retry" recovery.

### Response headers the gateway sets (from `middleware.go`)
- `X-Request-Id` — echoed/generated; surface in error toasts for support.
- `X-Memory-Version` — set on write/patch/pin/unpin/disable/enable/delete/get responses (when version > 0). A convenient secondary source of the new version, but the JSON body `version` is authoritative.
- `X-Consistency-Level` — recall + delete.

### D-03 RESOLVED — recall request/response schema (no sort, no paging) [VERIFIED: gateway httpapi/types.go + golden JSON]

**Request `RecallUnifiedRequest`:**
```jsonc
{
  "scope":               { },        // ScopePayload — send empty; headers authoritative
  "query":               "string",   // REQUIRED, non-empty (else 400 "query is required")
  "top_k":               8,          // optional int; 0 → defaults to 8; >50 → 400 "top_k must be <= 50"
  "token_budget":        1200,       // optional — leave unset for the console
  "memory_token_budget": 400,        // optional — leave unset (can DROP hits if set; avoid)
  "consistency_level":   "eventual", // optional: "eventual" | "bounded" | "strong"
  "allow_stale_cache":   false,      // optional
  "debug":               false       // optional
}
```
There is **NO** `sort`, `order`, `offset`, `page`, `cursor`, or `limit` field. **Confirmed absent.**

**Response `RecallUnifiedResponse`:**
```jsonc
{
  "hits": [
    {
      "memory_id": "mem_123",
      "kind":      "semantic",          // working | episodic | semantic
      "score":     0.95,                // ranked desc; the rank/sort key
      "version":   7,                   // CARRY THIS → expected_version for mutations
      "content":   "string",
      "tags":      ["preference","style"],   // omitted if empty
      "source":    "user_saved",
      "category":  "profile",
      "pinned":    true,                // D-13: lifecycle state IS returned
      "disabled":  false,               // D-13: lifecycle state IS returned
      "metadata":  { "matched_by": "long_term_unified", "token_cost_estimate": 42 }
    }
  ],
  "trace": {                            // optional; present unless omitted
    "cache_level":             "l1",
    "consistency_level":       "eventual",
    "stale_served":            true,
    "memory_token_budget":     400,
    "returned_token_estimate": 42
  }
}
```
There is **NO** `total`, `total_count`, `next_cursor`, `has_more`, or paging envelope. Empty results return `{"hits": []}` (a valid `200`, drives the five-state **empty** state — distinct from error). Score field name is **`score`** (float, 0..1-ish). Hits arrive **already sorted by score descending** (the gateway's `buildRecallCandidates` ordering).

**→ D-03 plan directive:** Take the **client-side** path. One recall POST returns up to `top_k` (≤50) hits; feed them to `@tanstack/react-table` with `getSortedRowModel` + `getPaginationRowModel` (client models). To "see more," the operator raises `top_k` (bounded at 50) and the console re-POSTs — that is the only "paging" lever. Query key: `['recall', {query, top_k, consistency_level, ...filterParams}]` (see TanStack section). No server re-query on sort/page-change — only on query/top-k change.

### D-13 RESOLVED — lifecycle state visibility (badges yes, server-filter no) [VERIFIED: gateway httpapi/types.go]
- Recall hits **return** `pinned` (bool) and `disabled` (bool) on every hit. → **Badges YES** (per-row pinned/disabled status badges, icon+text per 01-UI-SPEC status-color layer).
- Recall request accepts **no** `pinned`/`disabled` filter params (the request schema above is exhaustive). → **Server-side filter NO.**
- **→ D-13 plan directive:** Land on the **badges + client-side filter** rung. Render badges from the recall response; the "Advanced" filter panel's pinned/disabled toggles filter **client-side** over the already-fetched hits (same client-model table as D-03). The drawer detail (GET item) also shows both flags. This is internally consistent: D-03 already forces a client-side table, so client-side state-filtering rides on the same model with zero extra round-trips.

### D-09 RESOLVED — mutation response shapes (lean; hybrid reflect strategy) [VERIFIED: gateway httpapi/types.go + golden JSON]

| Endpoint | Response body | Returns full item? | Reflect strategy |
|----------|---------------|--------------------|------------------|
| `POST /memory/write` | `{ "memory": { "memory_id", "version", "status" } }` | **No** (no content/tags) | **Refetch** GET item to populate; insert nothing into the recall list (write is not a search) — toast success + offer to open the new item |
| `PATCH /memory/items/{id}` | `{ "memory_id", "version" }` | **No** | **Refetch** GET item for the new body; update the drawer + the recall-row's `version` |
| `POST .../pin` / `.../unpin` | `{ "memory_id", "version", "pinned" }` | Partial (flag echoed) | **Reflect-from-response**: `setQueryData` merge `{pinned, version}` onto the hit/item |
| `POST .../disable` / `.../enable` | `{ "memory_id", "version", "disabled" }` | Partial (flag echoed) | **Reflect-from-response**: `setQueryData` merge `{disabled, version}` |
| `DELETE /memory/items/{id}` | `{ "memory_id", "deleted", "version" }` | n/a | **Remove the row** from the recall query data locally (D-09) |

**→ D-09 plan directive:** Hybrid. (a) **pin/unpin/disable/enable** echo their flag + new version → merge in place with `setQueryData` (no refetch). (b) **patch/write** return only `{memory_id, version}` → do a single-item **`GET /memory/items/{id}` refetch** to obtain the authoritative `content`/`tags`/`category`, then `setQueryData` the recall row + drawer from it. (c) **delete** → splice the row out of cached recall data. In **all** cases, never auto-re-run recall (D-09) — a manual "refresh search" affordance re-POSTs recall. This honors pessimistic UI (D-11): the response (or the refetch) is the source of truth; no optimistic flip-then-revert.

### `expected_version` — the optimistic-concurrency gate (CRITICAL, design-shaping) [VERIFIED: gateway service.go]
Every mutating lifecycle call **requires** `expected_version` (`int64`, `> 0`):
- patch / pin / unpin / disable / enable / delete all return `400 bad_request "expected_version is required"` if it is `<= 0` or absent.
- If the supplied version is stale (record moved on), the gateway returns `409 memory_conflict` with `details: {memory_id, expected_version, current_version}`.
- `write` is the exception — it has no `expected_version` (it creates) but requires `idempotency_key` (non-empty) and `record.content` (non-empty) and `record.kind ∈ {working, episodic, semantic}`.

**→ planner directives:**
1. The console must **carry `version` for every item** it can act on. Recall hits and GET both include `version`; cache it alongside the item. Every mutation sends the cached `version` as `expected_version`.
2. **`409 memory_conflict` is an expected, first-class state**, not a crash. UX: toast "{Action} failed — 409: the item changed. Refreshing…", auto-refetch GET item to get the new version, and let the operator retry. This pairs naturally with pessimistic UI.
3. After any successful mutation, the **new `version` in the response replaces the cached one** so the next action sends a fresh `expected_version`.
4. **Idempotency:** pin/unpin/disable/enable are short-circuited server-side to a no-op success when the record is already in the target state at the given version (`terminalStateShortCircuit`) — so a double-click returns success, not a spurious conflict. patch/write idempotency is keyed on `idempotency_key`; the console should generate a fresh key per write/patch submit (e.g. a UUID) to make retries safe.

### Item record shape — grounds the zod schema (D-07) [VERIFIED: gateway httpapi/types.go + golden JSON]

**`GET /memory/items/{id}` → `GetMemoryItemResponse`** (the canonical "full item"):
```jsonc
{
  "memory_id":  "mem_123",
  "kind":       "semantic",       // working | episodic | semantic
  "version":    7,
  "content":    "string",
  "tags":       ["preference","style"],   // omitted if empty
  "source":     "user_saved",
  "category":   "profile",
  "importance": 0.95,             // omitted if zero
  "pinned":     true,
  "disabled":   false
}
```

**Write editor (D-07) — `WriteRecordPayload` (the writable fields):**
```jsonc
{
  "kind":       "semantic",   // REQUIRED ∈ {working, episodic, semantic}
  "source":     "user_saved",
  "category":   "project",
  "content":    "string",     // REQUIRED non-empty
  "tags":       ["..."],      // optional
  "importance": 0.95,         // optional float
  "pinned":     true          // optional bool
}
```
Wrapped as `{ "idempotency_key": "<uuid>", "scope": {}, "record": { ...above } }`.

**Patch editor (D-07) — `PatchMemoryFields` (all optional, pointer-semantics):**
```jsonc
{ "content"?: "string", "category"?: "string", "tags"?: ["..."], "importance"?: 0.0 }
```
Only these four are patchable. **`kind`, `source`, `pinned`, `disabled` are NOT patchable** via PATCH — pinned/disabled change only through the dedicated pin/disable endpoints; kind/source are immutable post-write. Wrapped as `{ "idempotency_key"?: "<uuid>", "scope": {}, "expected_version": <int>, "patch": { ...above } }`. An empty `patch: {}` is accepted by the wire codec (see `patch_memory_request_nil_fields.json`) but is a no-op the console should prevent client-side.

**→ zod schema directive:** Derive two schemas — `writeRecordSchema` (kind enum required, content min(1), the rest optional) and `patchFieldsSchema` (all optional, at least one key present). The gateway is the authoritative validator; the zod layer is fast pre-submit feedback only. **The raw-JSON editor (D-07) should validate the `record` / `patch` object** (not the full envelope — the console assembles `idempotency_key`, `scope:{}`, `expected_version` around the operator's JSON).

## Architecture Patterns

### System Architecture Diagram (data flow)
```
                         ┌─────────────── Browser (React 19 SPA) ──────────────┐
 operator types query →  │ MemoryPage                                          │
                         │  ├─ SearchControls ──(URL search params)──┐         │
                         │  │   query, top_k, advanced filters        │         │
                         │  │                                         ▼         │
                         │  │                              useRecallQuery       │
                         │  │                              key:['recall',{...}] │
                         │  ├─ ResultsTable (react-table, CLIENT sort/page/filter)
                         │  │     row → badges(pinned/disabled) + quick-actions │
                         │  │     row click → setSearchParam(?item=id)          │
                         │  ├─ ItemDrawer (sheet) ── open when ?item set ───────┤
                         │  │     useItemQuery key:['memory-item', id]          │
                         │  │     rendered fields + RawJsonViewer + actions      │
                         │  └─ EditorDrawer (write|patch mode) ── zod validate  │
                         │        useMutation → onSuccess: setQueryData / refetch│
                         └──────────────────────┬──────────────────────────────┘
                                                │ same-origin fetch  /api/memory/*
                                                │ headers: X-Console-Tenant/User/...
                                                ▼
                         ┌──────────── Go BFF (httputil.ReverseProxy) ─────────┐
                         │ strip inbound X-*-Id + Authorization                 │
                         │ re-materialize X-Tenant-Id / X-User-Id (+ proj/sess) │
                         │ allowlist /api/memory/* → gateway /memory/*          │
                         └──────────────────────┬──────────────────────────────┘
                                                ▼  HTTP (no SSE this phase)
                         ┌──────────── memory-gateway (:8080, FIXED) ──────────┐
                         │ recall/unified · write · patch · pin/unpin ·         │
                         │ disable/enable · delete · get  (expected_version OCC)│
                         └──────────────────────────────────────────────────────┘
```

### Recommended feature structure (slice-based, MVP mode)
```
src/features/memory/
├── api/
│   ├── client.ts          # typed /api/memory/* fetchers (recall, getItem, write, patch, pin…)
│   ├── schemas.ts         # zod: recallHit, memoryItem, writeRecord, patchFields, gatewayError
│   └── queries.ts         # useRecallQuery, useItemQuery, query-key factory
├── components/
│   ├── SearchControls.tsx # query + top_k + advanced panel (URL-param bound)
│   ├── ResultsTable.tsx   # react-table, client sort/page/filter, badges, row actions
│   ├── ItemDrawer.tsx     # sheet; detail + RawJsonViewer + action set (?item synced)
│   ├── EditorDrawer.tsx   # one editor, write|patch modes (D-08), zod raw-JSON (D-07)
│   ├── LifecycleActions.tsx # pin/unpin/disable/enable/delete buttons + confirms
│   └── StateBadges.tsx    # pinned/disabled badges (D-13)
├── hooks/
│   ├── useMemoryMutations.ts # mutations + setQueryData/refetch reflect logic (D-09)
│   └── useMemorySearchParams.ts # TanStack Router search-param bridge (D-02/D-05)
└── routes/
    └── memory.tsx         # route + searchSchema (query, top_k, item, advanced…)
```

### Vertical slices (MVP build order)
1. **Slice A — recall→render (MEM-01, MEM-08):** route + search params + recall query + table with badges + the D-12 unset-context full-page block. Proves auth injection + Query cache end-to-end. Ship this first.
2. **Slice B — detail drawer (MEM-02):** `?item={id}` → GET item → drawer with rendered fields + RawJsonViewer. Deep-link reopen.
3. **Slice C — write/patch + lifecycle (MEM-03..07):** editor drawer (zod), then pin/unpin/disable/enable/delete with `expected_version`, pessimistic reflect (D-09), and the two confirm weights (D-10). The OCC-conflict path is part of this slice's done-definition.

### Pattern: query-key factory keyed on URL params (D-02/D-05)
```ts
// Source: TanStack Query key best-practice + this phase's URL-param-as-state decision
export const memoryKeys = {
  recall: (params: RecallParams) => ['recall', params] as const,       // params = serialized URL filter state
  item:   (id: string)           => ['memory-item', id] as const,
};
// Recall query re-runs when query/top_k/consistency change (params change → new key).
// Sort/page/state-filter do NOT change the key — they are client-side over cached hits (D-03/D-13).
```

### Pattern: reflect-from-response vs refetch (D-09)
```ts
// flag toggle (pin) — response echoes flag+version → merge, no refetch
onSuccess: (resp) => queryClient.setQueryData(memoryKeys.item(id), prev =>
  prev ? { ...prev, pinned: resp.pinned, version: resp.version } : prev);
// patch — response is {memory_id,version} only → refetch GET for the body
onSuccess: () => queryClient.invalidateQueries({ queryKey: memoryKeys.item(id) });
```

### Anti-Patterns to Avoid
- **Sending real tenant/user in the request body `scope`.** The BFF headers are authoritative and override it; sending identity client-side duplicates and risks confusion. Send `scope: {}`.
- **Optimistic flag flips.** D-11/ROADMAP lock pessimistic UI; the `expected_version` gate makes optimism actively dangerous (a flip then a 409 revert is the exact UX the project forbids).
- **Auto re-running recall after a mutation.** D-09 forbids it; reflect-in-place or refetch the single item.
- **Treating `409 memory_conflict` as a generic error.** It is an expected concurrency outcome with a defined recovery (refetch version, retry).
- **Building server-side sort/page UI affordances.** The endpoint can't honor them; only `top_k` changes trigger a re-POST.
- **Forgetting `Content-Type: application/json` on DELETE.** This DELETE carries a body; the gateway 400s without the header.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Results sort/page/filter | Custom array sort + slice + filter state | `@tanstack/react-table` client models (`getSortedRowModel`, `getPaginationRowModel`, column filters) | Already in stack; handles edge cases, stable sort, header state |
| Filter/drawer state in URL | Hand-parsed `window.location.search` | TanStack Router `validateSearch` + `useSearch`/`navigate` | Type-safe, reproducible/shareable (D-02/D-05), browser-back closes drawer for free |
| Cache + dedupe + mutation reflect | Custom `useState` + manual fetch | TanStack Query `setQueryData` / `invalidateQueries` | Locked stack; D-09 reflect strategy is exactly its mutation API |
| JSON validation | Custom parser/validator | `zod` parse + `JSON.parse` try/catch | Inline parse + schema errors (D-07); zod already in stack |
| Toasts / confirms / drawer / badges | Bespoke components | Phase-1 sonner toast + shadcn dialog/sheet/badge | Built in Phase 1; reuse the design-system contract |
| `expected_version` retry | Silent retry loop | Surface 409 → refetch → operator retries | Pessimistic + visible (project value: never hide failures) |

**Key insight:** This phase is "wire the locked stack to a known contract correctly," not "invent mechanisms." The only genuinely new logic is the **version-carrying + OCC-conflict handling** — and even that is just threading the gateway's `version` field through the cache.

## Runtime State Inventory

Not a rename/refactor/migration phase — this is a greenfield feature slice. Section omitted by trigger rule. (No stored data, service config, OS state, secrets, or build artifacts are renamed or migrated.)

## Common Pitfalls

### Pitfall 1: Mutating without the current `version`
**What goes wrong:** Mutation 400s ("expected_version is required") or 409s (stale).
**Why:** Gateway enforces OCC on every lifecycle call; the console forgot to carry/refresh `version`.
**How to avoid:** Always cache `version` with the item (from recall hit or GET); send it as `expected_version`; replace it from each mutation response.
**Warning signs:** 400 bad_request on a pin/disable; 409 on a second action against the same item after an unrelated change.

### Pitfall 2: Expecting recall to support sort/offset
**What goes wrong:** Planner designs server-side pagination UI that the gateway silently ignores (extra body fields → `DisallowUnknownFields` actually **rejects** them with 400).
**Why:** `decodeJSON` uses `DisallowUnknownFields()` — sending `sort`/`offset` is a hard 400, not a silent ignore.
**How to avoid:** Send only the documented request fields; do all sort/page/filter client-side.
**Warning signs:** 400 bad_request "invalid JSON payload" on recall.

### Pitfall 3: Reflecting patch/write from the lean response
**What goes wrong:** Drawer shows stale `content` after a successful patch because the response had no body.
**Why:** patch/write return only `{memory_id, version}`.
**How to avoid:** Refetch `GET /memory/items/{id}` after patch/write; only flag-toggles can reflect-from-response.

### Pitfall 4: Sending non-empty body `scope` and assuming it scopes the call
**What goes wrong:** Operator puts a tenant in the editor JSON; it's silently overridden by the header → confusion.
**Why:** `MergeAuthoritativeScope` forces header tenant/user.
**How to avoid:** Console assembles `scope: {}`; the raw-JSON editor exposes only `record`/`patch`, never `scope`.

### Pitfall 5: Confusing empty-results with error
**What goes wrong:** Zero hits rendered as an error or blank.
**Why:** `{"hits": []}` is a `200`.
**How to avoid:** Five-state: `hits.length === 0` → **empty** state (distinct copy from the D-12 unset-context gate and from the error state).

### Pitfall 6: DELETE without Content-Type / body
**What goes wrong:** 400 "Content-Type must be application/json".
**Why:** `EnsureJSONRequest` covers DELETE; this DELETE carries `{expected_version, scope, consistency_level?}`.
**How to avoid:** Always set the header and send the body on DELETE.

## Code Examples

### Recall fetch (client)
```ts
// Source: gateway httpapi/types.go (request/response), Phase-1 BFF same-origin /api prefix
async function recall(params: { query: string; top_k?: number; consistency_level?: string }) {
  const res = await fetch('/api/memory/recall/unified', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }, // X-Console-* added by app fetch wrapper
    body: JSON.stringify({ scope: {}, query: params.query, top_k: params.top_k ?? 8,
                           consistency_level: params.consistency_level }),
  });
  if (!res.ok) throw await parseGatewayError(res); // {error:{code,message,request_id,details}}
  return RecallUnifiedResponse.parse(await res.json()); // zod
}
```

### Pin (reflect-from-response, carries version)
```ts
// Source: gateway pin_handler.go + PinMemoryResponse{memory_id,version,pinned}
async function pin(id: string, expected_version: number) {
  const res = await fetch(`/api/memory/items/${id}/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: {}, expected_version }),
  });
  if (!res.ok) throw await parseGatewayError(res); // may be 409 memory_conflict
  return res.json() as Promise<{ memory_id: string; version: number; pinned: boolean }>;
}
```

### Delete (red destructive dialog, then DELETE with body)
```ts
// Source: gateway delete_handler.go + DeleteMemoryRequest/Response
async function del(id: string, expected_version: number) {
  const res = await fetch(`/api/memory/items/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: {}, expected_version }),
  });
  if (!res.ok) throw await parseGatewayError(res);
  return res.json() as Promise<{ memory_id: string; deleted: boolean; version: number }>;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Server-driven table (server sort/page/filter) | **Client-driven table** over a fixed top-k | Forced by gateway contract | Simpler; bounded by `top_k ≤ 50` |
| Optimistic mutation + rollback | **Pessimistic** reflect-after-confirm | Project decision (D-11/ROADMAP) + OCC gate | Visible failures; no flip-revert |
| Full route per item | **Sheet drawer** + `?item=` search param | D-04/D-05 | Fast triage, keeps deep-link value |

**Deprecated/outdated:** none — greenfield against a current contract.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | shadcn `sheet` (not `drawer`) is the right slide-over primitive for the desktop detail drawer (D-04) | Standard Stack | Low — both are official blocks; planner confirms block name at `shadcn add` time; trivial swap |
| A2 | The BFF maps `/api/memory/*` → gateway `/memory/*` (prefix set in Phase 1, Claude's-discretion) | Architecture | Low — Phase-1 owns the prefix; console reuses whatever it built. Planner must read the executed Phase-1 BFF route table to confirm the exact prefix before coding the client base path. |
| A3 | A fresh UUID `idempotency_key` per write/patch submit is the right retry-safety approach | expected_version §4 | Low — matches gateway idempotency semantics; alternative is omit-key (patch allows empty), but a key makes retries safe |

**Note:** A2 is the one item the planner MUST verify against **executed Phase-1 code** (the BFF route table), because Phase 1 was not yet executed at research time — the prefix is a Phase-1 implementation detail, not a gateway fact. Everything in THE GATEWAY CONTRACT section is verified from gateway source and is not assumed.

## Open Questions

1. **Exact BFF `/api` prefix + per-service namespacing.**
   - What we know: Phase-1 Claude's-discretion; PROJECT/CONTEXT reference `/api/memory/*`.
   - What's unclear: whether it's `/api/memory/*`, `/api/gateway/*`, or another shape — Phase 1 wasn't executed at research time.
   - Recommendation: planner reads the executed Phase-1 BFF router before writing the console's API base path; treat `/api/memory/*` as the expected default.

2. **`source` / `category` allowed value sets.**
   - What we know: golden samples use `source:"user_saved"`, `category:"profile"|"project"`; gateway does **not** enum-validate these (only `kind` and `content` are validated in `WriteMemory`).
   - What's unclear: whether the operator should pick from a fixed list or type freely.
   - Recommendation: free-form text in the raw-JSON editor (consistent with D-07's freeform-record rationale); no client enum.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| memory-gateway running (`:8080`) | All MEM flows end-to-end | Runtime/deploy concern | — | Vitest mocks the `/api/memory/*` fetch layer; manual e2e needs the compose stack up |
| Phase-1 BFF + SPA shell | Everything (substrate) | **Not yet executed** at research time | — | **Blocking ordering dependency** — Phase 2 cannot ship before Phase 1 is built |

**Missing dependencies with no fallback:**
- **Phase-1 foundation must be executed first.** Phase 2 consumes the BFF directors, operator-context bar, five-state wrapper, raw-JSON viewer, copyable-id, toast, and destructive-dialog pattern — none exist yet. This is the roadmap-ordained ordering, not a gap to fix here, but the planner must not assume those primitives are present until Phase 1 lands.

**Missing dependencies with fallback:**
- Live gateway for tests → Vitest + MSW/fetch-mock against the contract documented above (the golden JSON shapes are ready-made fixtures).

## Validation Architecture

> nyquist_validation is `true` in config.json — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.x + @testing-library/react [CITED: PROJECT.md STACK] |
| Config file | none yet — established in Phase 1; **Wave 0 if absent** |
| Quick run command | `npm run test -- src/features/memory --run` |
| Full suite command | `npm run test -- --run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MEM-01 | Recall renders ranked hits w/ score + metadata; empty→empty-state | component | `vitest src/features/memory/ResultsTable.test.tsx --run` | ❌ Wave 0 |
| MEM-01 | Client-side sort/page/filter over top-k (no server re-query) | component | `vitest src/features/memory/ResultsTable.test.tsx --run` | ❌ Wave 0 |
| MEM-02 | `?item=id` opens drawer, GET item renders fields + raw JSON | component | `vitest src/features/memory/ItemDrawer.test.tsx --run` | ❌ Wave 0 |
| MEM-03 | Write: zod rejects empty content / bad kind before submit | unit | `vitest src/features/memory/schemas.test.ts --run` | ❌ Wave 0 |
| MEM-04 | Patch sends `expected_version`; refetches GET on success | unit | `vitest src/features/memory/useMemoryMutations.test.ts --run` | ❌ Wave 0 |
| MEM-05 | Pin reflects `{pinned,version}` from response via setQueryData | unit | `vitest src/features/memory/useMemoryMutations.test.ts --run` | ❌ Wave 0 |
| MEM-06 | Disable shows **neutral** confirm; enable no confirm | component | `vitest src/features/memory/LifecycleActions.test.tsx --run` | ❌ Wave 0 |
| MEM-07 | Delete shows **red destructive** confirm; pessimistic remove-after-200 | component | `vitest src/features/memory/LifecycleActions.test.tsx --run` | ❌ Wave 0 |
| MEM-07 | `409 memory_conflict` surfaces + triggers item refetch | unit | `vitest src/features/memory/useMemoryMutations.test.ts --run` | ❌ Wave 0 |
| MEM-08 | Unset tenant/user → full-page block, no requests fired | component | `vitest src/features/memory/MemoryPage.test.tsx --run` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test -- src/features/memory --run`
- **Per wave merge:** `npm run test -- --run`
- **Phase gate:** full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/features/memory/api/schemas.ts` zod fixtures from the golden JSON shapes above (reusable test fixtures)
- [ ] Vitest config + `@testing-library/react` setup — **only if Phase 1 did not already establish it** (it should have; verify, don't duplicate)
- [ ] `src/test/mocks/memory-gateway.ts` — MSW/fetch-mock handlers returning the documented contract shapes (incl. a 409 conflict and an empty-hits case)
- [ ] Shared QueryClient test wrapper (if not provided by Phase 1)

*(If Phase 1 established Vitest + RTL + a QueryClient test wrapper, only the memory-specific fixtures/mocks and test files are new.)*

## Security Domain

> security_enforcement not present in config.json → treated as enabled. Section included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | partial | Operator-token + scope injection live at the **BFF** (Phase-1, BFF-02); this phase fires no auth itself, only sends `X-Console-*` |
| V3 Session Management | no | Internal tool; no in-app session/cookie (Phase-1 D-01: token in memory, no cookie) |
| V4 Access Control | yes | **Scope confinement** — console must NEVER send client-trusted `X-Tenant-Id`/`X-User-Id`; only `X-Console-*` (BFF re-materializes). Body `scope:{}` (header authoritative). |
| V5 Input Validation | yes | zod on the raw-JSON editor (D-07); gateway is authoritative validator. Never `eval`/unsanitized render of `content` (render as text, not HTML). |
| V6 Cryptography | no | No crypto in the console; secrets (flowd bearer, operator token) stay server-side (Phase-1) |

### Known Threat Patterns for React-SPA + Go-BFF + fixed gateway
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stored XSS via memory `content`/`tags` rendered as HTML | Tampering / Elevation | Render all gateway strings as **text nodes** (React default-escapes); raw-JSON viewer shows escaped text; never `dangerouslySetInnerHTML` |
| Client-trusted identity headers (confused deputy) | Spoofing | BFF strips inbound `X-*-Id`/`Authorization` and re-materializes (Phase-1, PITFALLS.md); console sends only `X-Console-*` + `scope:{}` |
| SSRF / open proxy via unmapped routes | Tampering | BFF allowlists `/api/memory/*` → fixed gateway routes only (Phase-1, BFF-01); console never constructs arbitrary upstream URLs |
| Leaking `request_id`/`details` containing internal data | Info disclosure | Surface `error.message` + `request_id` to the operator (internal tool — acceptable); do not log to third parties |
| Destructive action without confirm (operator error) | (operational) | D-10: red destructive dialog for delete, neutral confirm for disable; pessimistic reflect (D-11) |

## Sources

### Primary (HIGH confidence)
- `../llm-agent-memory-gateway/internal/transport/router.go` — exact routes + path param `memory_id`
- `../llm-agent-memory-gateway/internal/httpapi/types.go` — all request/response struct shapes (recall, write, patch, pin, disable, delete, get)
- `../llm-agent-memory-gateway/internal/httpapi/errors.go` — error envelope + code→HTTP-status mapping
- `../llm-agent-memory-gateway/internal/authz/scope.go` — header-scope rules + `MergeAuthoritativeScope`
- `../llm-agent-memory-gateway/internal/service/service.go` — validation rules, `expected_version` OCC enforcement, `mergeScope`, idempotency, topK cap (≤50)
- `../llm-agent-memory-gateway/internal/transport/{recall,get,write,patch,pin,unpin,disable,enable,delete}_handler.go` + `middleware.go` — Content-Type gate, response headers, handler wiring
- `../llm-agent-memory-gateway/internal/httpapi/testdata/wire/*.json` — golden request/response JSON (ready-made test fixtures)
- `.planning/phases/02-memory-console/02-CONTEXT.md` — locked decisions D-01..D-13
- `.planning/phases/01-foundation/{01-CONTEXT.md,01-UI-SPEC.md}` — substrate + design contract
- `.planning/PROJECT.md` (## Technology Stack) — locked stack + verified route/auth inventory
- `.planning/REQUIREMENTS.md` — MEM-01..08

### Secondary (MEDIUM confidence)
- shadcn/ui `sheet` vs `drawer` primitive distinction — training knowledge, flagged A1 for confirm at install

### Tertiary (LOW confidence)
- None — no unverified web claims were relied upon (the contract was read from source).

## Metadata

**Confidence breakdown:**
- Gateway contract (the 3 gated decisions + record shapes + OCC): **HIGH** — read from source + golden JSON, not training data.
- Standard stack: **HIGH** — locked by Phase-1 research; no new packages.
- Architecture/patterns: **HIGH** — derived directly from the verified contract + locked CONTEXT decisions.
- Pitfalls: **HIGH** — each traces to a specific gateway code path (DisallowUnknownFields, EnsureJSONRequest, expected_version, MergeAuthoritativeScope).
- BFF route prefix: **MEDIUM** — Phase-1 implementation detail, not yet executed (A2/Open Q1).

**Research date:** 2026-06-03
**Valid until:** gateway contract is pinned by golden wire tests (stable; re-verify only if `../llm-agent-memory-gateway` CHANGELOG shows a memory-API change). Stack: 30 days.
