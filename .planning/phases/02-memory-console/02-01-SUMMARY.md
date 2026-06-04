---
phase: 02-memory-console
plan: 01
subsystem: memory
tags: [react19, tanstack-query, zod, memory-gateway, occ, vitest, data-layer]

# Dependency graph
requires:
  - phase: 01-04
    provides: "makeApiFetcher(ctx) — the single X-Console-* identity-injection point — + useOperatorContext hook"
  - phase: 01-02
    provides: "Vitest + @testing-library/react harness, vitest.config (@ alias, jsdom, setup.ts), QueryClient"
provides:
  - "schemas.ts: zod schemas for the verified gateway wire contract — recallHitSchema, recallResponseSchema, memoryItemSchema, writeRecordSchema, patchFieldsSchema, gatewayErrorSchema, memoryConflictDetailsSchema (+ kindEnum)"
  - "client.ts: typed /api/memory/* fetchers (recall, getItem, write, patch, pin, unpin, disable, enable, del) + parseGatewayError; MEMORY_BASE='/api/memory'; scope:{} bodies; expected_version OCC threading; idempotency_key on write/patch; body-bearing DELETE Content-Type"
  - "queries.ts: memoryKeys query-key factory + useRecallQuery/useItemQuery bound to Phase-1 makeApiFetcher (X-Console-* injection); recall enabled only on non-empty query"
  - "memory-gateway.ts: golden-wire fixtures (incl. empty-hits + 409 conflict) + installMemoryFetchMock method/path fetch router — reusable test harness for all later slices"
affects: [phase-02-02-recall-render, phase-02-03-drawer, phase-02-04-lifecycle]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fetcher-takes-apiFetch: each client fn receives the Phase-1 apiFetch as arg 1 so X-Console-* injection is inherited and identity is never client-trusted (T-02-01)"
    - "zod narrows untrusted upstream JSON at the client boundary before it reaches UI state (V5); gateway stays the authoritative validator"
    - "patchFieldsSchema = .strict().refine(>=1 key) so non-patchable fields (kind/source/pinned/disabled) and empty no-op patches are rejected client-side (D-07)"
    - "parseGatewayError returns (not throws) a normalized error with httpStatus + a narrowed .conflict for 409 memory_conflict so callers drive OCC recovery"
    - "query-key factory keys recall ONLY on {query,top_k,consistency_level}; sort/page/state-filter stay client-side (D-03/D-13) and out of the key"
    - "installMemoryFetchMock: vi.stubGlobal fetch router matching method+path (origin/query stripped) returning real Response objects so res.ok/json()/parseGatewayError run as in production"

key-files:
  created:
    - web/src/features/memory/api/schemas.ts
    - web/src/features/memory/api/client.ts
    - web/src/features/memory/api/queries.ts
    - web/src/features/memory/api/schemas.test.ts
    - web/src/features/memory/api/client.test.ts
    - web/src/test/mocks/memory-gateway.ts
  modified: []

key-decisions:
  - "RED+GREEN land in one atomic feat commit per task (per the established 01-03/01-04/01-05 convention); RED was verified separately (module-resolution failure) before each implementation"
  - "patchFieldsSchema rejects non-patchable keys via .strict() (chosen over strip) so the editor surfaces an operator pasting kind/source/pinned — per the plan's explicit 'choose reject' directive (D-07)"
  - "Two acceptance greps (forbidden sort/offset/cursor and X-Tenant-Id/X-User-Id) initially matched explanatory COMMENT text, not code; reworded the comments (no behavior change) so the literal-token greps return 0 — same accommodation precedent as 01-05"
  - "consistency_level is omitted from the recall body when unset (rather than sent as undefined) so DisallowUnknownFields never sees a stray key"

requirements-completed: [MEM-01, MEM-03, MEM-04]

# Metrics
duration: 5min
completed: 2026-06-03
---

# Phase 2 Plan 01: Typed /api/memory client + zod schemas + test mock harness Summary

**The Wave-0 data layer for the Memory Console: zod schemas mirroring the source-verified memory-gateway wire contract (recall/item/write/patch + the standard error envelope and the 409 `memory_conflict` details), a typed `/api/memory/*` client that threads `expected_version` OCC on every mutation, sends `scope:{}` bodies, sets Content-Type on the body-bearing DELETE, and never client-trusts identity headers (it inherits the Phase-1 `makeApiFetcher` X-Console-* injection), a TanStack Query key factory + recall/item hooks, and a golden-wire fetch-mock harness (with empty-hits and 409-conflict cases) reusable by every later slice.**

## Performance

- **Duration:** ~5 min
- **Tasks:** 2 of 2 (both TDD)
- **Files:** 6 created (3 source + 1 mock + 2 test suites) under `web/`; node_modules NOT committed

## Accomplishments

- **schemas.ts** (`kindEnum`, `recallHitSchema`, `recallResponseSchema`, `memoryItemSchema`, `writeRecordSchema`, `patchFieldsSchema`, `gatewayErrorSchema`, `memoryConflictDetailsSchema`) — each field set copied from the golden wire JSON, not guessed. `writeRecordSchema` requires `kind ∈ {working,episodic,semantic}` + `content.min(1)`; `patchFieldsSchema` is `.strict().refine(>=1 key)` so empty patches and non-patchable fields (kind/source/pinned/disabled) are rejected (D-07). `recallResponseSchema` accepts both the golden non-empty shape and `{hits:[]}`; metadata/trace are `.loose()` (passthrough-tolerant).
- **client.ts** (`MEMORY_BASE='/api/memory'`, `recall`, `getItem`, `write`, `patch`, `pin`, `unpin`, `disable`, `enable`, `del`, `parseGatewayError`) — every fetcher takes the Phase-1 `apiFetch` as arg 1 (X-Console-* inherited; zero client-trusted identity headers). All bodies carry `scope:{}`; every mutation threads `expected_version`; `write`/`patch` carry a fresh `crypto.randomUUID()` idempotency_key; the body-bearing DELETE sets `Content-Type: application/json` (Pitfall 6). `parseGatewayError` returns a normalized error (`{error, httpStatus, conflict?}`) where a 409 `memory_conflict` exposes `conflict.current_version` for OCC recovery; non-envelope bodies fall back to a synthetic `transport_error`. Recall sends ONLY documented fields (no rank/skip/seek/window params — DisallowUnknownFields would 400).
- **queries.ts** (`memoryKeys`, `useRecallQuery`, `useItemQuery`) — keys: `recall(params)=>['recall',params]`, `item(id)=>['memory-item',id]`. Hooks build `apiFetch` from `useOperatorContext()` via `makeApiFetcher` (memoized on the four scope fields). `useRecallQuery` is `enabled` only on a non-empty trimmed query (no doomed empty-query POST); `useItemQuery` only when an id is set. Sort/page/state-filter are deliberately NOT in the recall key (D-03/D-13 — client-side).
- **memory-gateway.ts** — canonical fixtures (`recallNonEmpty`, `recallEmpty={hits:[]}`, `itemFixture`, `pinResponse`, `unpinResponse`, `disableResponse`, `enableResponse`, `patchResponse`, `writeResponse`, `deleteResponse`, `conflict409`) verbatim from the golden wire JSON, plus `installMemoryFetchMock(routes)` — a `vi.stubGlobal` fetch router matching method+path and returning real `Response` objects (so `res.ok`/`json()`/`parseGatewayError` execute as in production). Includes the two required edge cases: empty-hits and the 409 envelope.

## Task Commits

1. **Task 1: zod schemas + memory-gateway test mock harness** — `57aa406` (feat, TDD: 13 behavior cases RED then GREEN)
2. **Task 2: typed /api/memory client + query hooks + key factory** — `f7e7ed0` (feat, TDD: 13 behavior cases RED then GREEN)

_TDD note: per the established Phase-1 convention, each task's RED and GREEN landed in one atomic feat commit; RED was verified separately (module-resolution failure) before each implementation._

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Two acceptance greps matched comment text, not code**
- **Found during:** Task 2 (acceptance-criteria gate)
- **Issue:** The acceptance greps `grep -cE 'sort|offset|cursor|"page"'` (must be 0) and `grep -c 'X-Tenant-Id|X-User-Id'` (must be 0) each returned 1 — both from explanatory JSDoc comments (one documenting that those recall params are deliberately omitted, one naming the forbidden identity headers the client never sets). The CODE was already correct (no such params sent, no such headers set).
- **Fix:** Reworded the two comments to convey the same meaning without the literal tokens (e.g. "rank/skip/seek/window params" and "client-trusted tenant/user identity headers"). No behavior change.
- **Files modified:** web/src/features/memory/api/client.ts
- **Verification:** both greps now return 0; `npx vitest run src/features/memory/api/client.test.ts` 13/13 green; `tsc --noEmit` exit 0.
- **Committed in:** `f7e7ed0` (the reword landed before the Task-2 commit)

**Precedent:** same acceptance-grep-vs-comment accommodation as Phase-1 plan 01-05 (`from {`); a documented, behavior-neutral wording adjustment, not a logic change.

## Threat Surface Scan

No new security-relevant surface beyond the plan's `<threat_model>`. All four mitigate dispositions are present:
- **T-02-01 (Spoofing, mitigate BLOCKING):** `grep -c 'X-Tenant-Id|X-User-Id' client.ts` = 0; identity rides only on X-Console-* via Phase-1 makeApiFetcher; bodies send `scope:{}`.
- **T-02-02 (Tampering, mitigate):** `grep -cE 'sort|offset|cursor|"page"' client.ts` = 0; recall sends only documented fields.
- **T-02-03 (Input validation V5, mitigate):** every response narrowed by zod (recallResponseSchema/memoryItemSchema) before reaching callers.
- **T-02-04 (Info disclosure, accept) / T-02-SC (installs, accept):** parseGatewayError surfaces request_id/details for the internal operator tool; zero new npm packages (`tech-stack.added: []`).

## Known Stubs

None. This is a complete, fully-wired data layer — no placeholder values, no TODO/FIXME, no mock data flowing to UI (no UI in this plan). The fixtures in `memory-gateway.ts` are test-only and clearly scoped to `src/test/`. UI consumers arrive in 02-02..02-04.

## Verification Evidence

- `cd web && npx vitest run src/features/memory/api` — **26 passed (2 files)** (schemas 13, client 13).
- `cd web && npx vitest run` (full suite) — **52 passed (9 files)** (26 new + 26 inherited Phase-1).
- `cd web && npx tsc --noEmit` — exit 0.
- `cd web && npm run build` — dist emitted (index.js 465.62 kB / gzip 146.98 kB), exit 0.
- `cd web && npm run lint` — exit 0 (0 errors; 2 pre-existing shadcn warnings on badge.tsx/button.tsx, unchanged since 01-02).
- Acceptance greps (client.ts): `'/api/memory'`=1 (≥1); `scope:{}`=6 (≥1); `sort|offset|cursor|"page"`=0; `expected_version`=18 (≥5); `application/json`=2 (≥1, incl. DELETE); `X-Tenant-Id|X-User-Id`=0. (schemas.ts): `working`=2 (≥1, episodic+semantic present); `min(1)`=1 (≥1); `memory_conflict|current_version`=4 (≥1). (memory-gateway.ts): empty-hits=3 (≥1); `409|memory_conflict`=4 (≥1). (queries.ts): `makeApiFetcher`=2 (≥1).
- node_modules NOT staged; no file deletions; `.planning/memory-inversion/` (out-of-scope untracked) left untouched.

## Next Plan Readiness

- **02-02 (recall→render, Slice A)** consumes `useRecallQuery` + `recallResponseSchema` types + the empty-hits fixture and `installMemoryFetchMock` to drive the `@tanstack/react-table` results view and the five-state empty path.
- **02-03 (drawer, Slice B)** consumes `useItemQuery` + `memoryItemSchema` + `itemFixture`.
- **02-04 (lifecycle, Slice C)** consumes `write`/`patch`/`pin`/`unpin`/`disable`/`enable`/`del` + `parseGatewayError`'s `.conflict` for the 409 OCC-recovery path, with `conflict409` driving the conflict test.
- **Environment note (honest):** the client was verified against mocked fetch (golden-wire fixtures), not a live BFF+gateway round-trip (Docker unreachable this session). The fixtures are the source-verified golden wire shapes, so the contract is exercised faithfully; live e2e carries forward to manual verification once the compose stack is up (per 02-VALIDATION Manual-Only table).

## Self-Check: PASSED

- All 6 created files exist (schemas/client/queries + 2 tests under web/src/features/memory/api/, mock under web/src/test/mocks/).
- Both task commits present in history: `57aa406` (Task 1), `f7e7ed0` (Task 2).

---
*Phase: 02-memory-console*
*Completed: 2026-06-03*
