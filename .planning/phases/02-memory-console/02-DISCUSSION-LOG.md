# Phase 2: Memory Console - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-03
**Phase:** 2-memory-console
**Areas discussed:** Search & results layout, Detail + action placement, Write/patch JSON editor, Lifecycle safety & cache, Unset-context gate weight, Delete vs disable confirm weight, Lifecycle state visibility, New-record entry point

---

## Search & results layout

| Option | Description | Selected |
|--------|-------------|----------|
| Data-table + simple query | react-table + one query box, defer advanced filters | |
| Data-table + advanced filters | query + top-k + score-threshold + metadata filters, URL search-param state | ✓ |
| Ranked cards | card per result with score badge | |

**User's choice:** Data-table + advanced filters → **D-01/D-02**
**Notes:** Exact recall/unified filter fields are research territory; this set the operator-facing shape.

### Filter presentation (follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| Collapsible advanced panel | query+top-k visible; threshold/metadata behind "Advanced" toggle | ✓ |
| Always-visible filter bar | all filters in a persistent bar | |

**User's choice:** Collapsible advanced panel → **D-02**

### Sort/page semantics (follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| Client-side over returned top-k | fetch top-k once; sort/page client-side | |
| Server re-query on sort/page | re-POST recall with sort/offset params | ✓ |

**User's choice:** Server re-query on sort/page → **D-03**
**Notes:** Captured as **research-gated** — depends on recall/unified accepting sort/offset params (unconfirmed). Fallback to client-side sort over top-k if not supported.

---

## Detail + action placement

| Option | Description | Selected |
|--------|-------------|----------|
| Full route + row quick-actions | deep-linkable /memory/items/{id} route + row action menu | |
| Side drawer + row quick-actions | drawer detail, list stays visible; row quick-actions | ✓ |
| Detail page only | actions only on full detail route, rows nav-only | |

**User's choice:** Side drawer + row quick-actions → **D-04/D-06**

### Drawer URL sync (follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| Sync open item to URL param | ?item={id}; reload reopens, shareable, back closes | ✓ |
| No URL sync (pure local state) | drawer is local state; reload loses it | |

**User's choice:** Sync open item to URL param → **D-05**

---

## Write/patch JSON editor

| Option | Description | Selected |
|--------|-------------|----------|
| Raw JSON + zod validate | mono JSON editor + zod, inline errors; patch pre-fills | ✓ |
| Structured form | react-hook-form typed fields per known field | |
| Hybrid form + raw escape hatch | form for common fields + raw JSON for the rest | |

**User's choice:** Raw JSON + zod validate → **D-07**

### New-record entry point (follow-up area)

| Option | Description | Selected |
|--------|-------------|----------|
| 'New record' button → same drawer editor | one editor, write=blank / patch=pre-filled | ✓ |
| Dedicated create route/screen | separate create surface | |

**User's choice:** 'New record' button → same drawer editor → **D-08**

---

## Lifecycle safety & cache

| Option | Description | Selected |
|--------|-------------|----------|
| Reflect-from-response, no auto re-search | setQueryData from mutation response; delete drops row; no auto re-run | ✓ |
| Invalidate + re-run last recall | re-execute last recall after any mutation | |
| Refetch single item only | GET /memory/items/{id} per mutation; list untouched | |

**User's choice:** Reflect-from-response, no auto re-search → **D-09**
**Notes:** Assumes mutation responses return the updated item; fallback to single-item refetch if any endpoint returns status-only. Confirm-on-destructive + pessimistic UI were already locked by the ROADMAP (D-10/D-11).

---

## Unset-context gate weight

| Option | Description | Selected |
|--------|-------------|----------|
| Full-page block | whole Memory console → "No operator context set" empty-state | ✓ |
| Search visible but disabled + banner | chrome rendered but inert + amber banner | |
| Actions-only disabled | page renders, only mutations disabled | |

**User's choice:** Full-page block → **D-12**

---

## Delete vs disable confirm weight

| Option | Description | Selected |
|--------|-------------|----------|
| Red for delete, neutral for disable | destructive red dialog for delete; lighter neutral confirm for disable | ✓ |
| Red destructive dialog for both | uniform red confirm for delete + disable | |

**User's choice:** Red for delete, neutral for disable → **D-10**

---

## Lifecycle state visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Badges + filters | pinned/disabled badges in table + filter by them (research-gated) | ✓ |
| Badges only, no filter | show badges, no lifecycle filters | |
| Detail drawer only | lifecycle state only in the drawer | |

**User's choice:** Badges + filters → **D-13**
**Notes:** Research-gated — fallback ladder: badges+filters → badges-only → drawer-only, depending on what recall/unified returns and can filter on.

---

## Claude's Discretion

- BFF route prefix/namespacing (reuse Phase 1).
- Per-action toast copy (follow Phase 1 UI-SPEC copywriting contract).
- Table columns + detail field rendering (driven by recall/item schema).
- zod schema shape for the editor (planner derives from write/patch contract).
- Zero-results empty-state vs error-state wording (five-state pattern; distinct from the unset-context gate).

## Deferred Ideas

- Session close/heartbeat view — v2 (no read endpoint to view session state).
- Saved/named searches or recall history — possible v1.x refinement of URL-synced filters.
- Optimistic UI — NOT chosen; ROADMAP locks pessimistic UI.
