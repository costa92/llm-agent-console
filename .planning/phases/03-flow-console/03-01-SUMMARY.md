---
phase: 03-flow-console
plan: 01
subsystem: api
tags: [flow, sse, zod, fetch-event-source, tanstack-query, base64, vitest]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: openSseStream stub (@microsoft/fetch-event-source wrapper), BFF flow director (/api/flow/* strips auth + injects flowd bearer), jsdom scrollTo stub
  - phase: 02-memory-console
    provides: features/api/{schemas,client,queries}.ts layout + query-key factory + installFetchMock harness pattern to mirror
provides:
  - "Typed /api/flow/* REST client (listFlows/getFlow/createFlow/putFlow/deleteFlow/runSync/listRuns/getRun/listRunEvents) with NO auth/X-Console-* headers"
  - "zod schemas for the verified flowd contract (FlowMeta, FlowRecord base64 json, RunMeta, RunRecord, RunEvent, 6-kind SSE payload, FLAT flowd error)"
  - "parseFlowdError — flow-specific flat {error:string} parser (NOT parseGatewayError)"
  - "decodeFlowJson — single base64 decode-on-load helper (A1)"
  - "openSseStream onOpen(response) hook (D-08) preserving fetch-event-source default open validation"
  - "runStream/replayStream wrappers surfacing X-Run-ID via onRunId exactly once"
  - "flowKeys query-key factory + REST read hooks (useFlowsQuery/useFlowQuery/useRunsQuery/useRunQuery/useRunEventsQuery)"
  - "Test mock harness: installFlowdFetchMock (204/400/409/404/500/empty-events) + makeFakeSseStream (4 golden sequences + X-Run-ID + onError/abort)"
affects: [03-02 flow CRUD, 03-03 streamed run + timeline reducer, 03-04 run history, 03-05 replay, 04-chat-console SSE]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "flowd client uses plain same-origin fetch (NO apiFetch/X-Console-*) — flowd is not scope-aware, BFF injects the bearer"
    - "SSE wrappers surface X-Run-ID via openSseStream onOpen hook (D-08), once per stream"
    - "base64 FlowRecord.json decoded in ONE helper (decodeFlowJson) so a live-GET verify touches one site"
    - "controllable fake openSseStream emitter drives onOpen→onRunId + scripts golden frame sequences without a live flowd"

key-files:
  created:
    - web/src/features/flow/api/schemas.ts
    - web/src/features/flow/api/client.ts
    - web/src/features/flow/api/stream.ts
    - web/src/features/flow/api/queries.ts
    - web/src/features/flow/api/schemas.test.ts
    - web/src/features/flow/api/client.test.ts
    - web/src/test/mocks/flowd.ts
    - web/src/test/mocks/fetch-event-source.ts
    - web/src/test/mocks/fetch-event-source.test.ts
  modified:
    - web/src/lib/sse.ts

key-decisions:
  - "flowd client sends NO bearer / NO X-Console-* (T-03-01) — plain fetch, not apiFetch (flowd not scope-aware; BFF injects)"
  - "FLAT flowdErrorSchema {error:string} + FlowdError(status,message) class; parseFlowdError falls back to res.statusText — NOT Phase-2 parseGatewayError"
  - "decodeFlowJson uses atob + TextDecoder (UTF-8 safe) in one place (A1 decode-on-load); putFlow sends raw flow + OMITS id (Pitfall 4); deleteFlow treats 204 as success without res.json (Pitfall 5)"
  - "openSseStream onOpen re-applies fetch-event-source's content-type open validation AFTER calling onOpen, so a non-2xx/wrong-content-type open still throws (no swallow)"
  - "onRunId fires at most once per stream (a reconnect open for the same run does not re-fire)"
  - "ssePayloadSchema is .loose() all-optional (populated-keys subset); seq lives only on RunEvent, never the SSE frame"

patterns-established:
  - "Pattern: imperative SSE wrappers (runStream/replayStream) over openSseStream, no auth, X-Run-ID→onRunId — the seam the 03-03 reducer/hook builds on"
  - "Pattern: installFlowdFetchMock returns real Response objects incl. genuinely empty-body 204 so the DELETE-no-parse path executes"
  - "Pattern: makeFakeSseStream is a drop-in openSseStream mock; tests call it directly or via vi.mock('@/lib/sse')"

requirements-completed: []  # Wave-0 infra only — FLOW-01..06 are DELIVERED by the UI slices (03-02..05), not this plan

# Metrics
duration: 16min
completed: 2026-06-04
---

# Phase 3 Plan 01: Flow Console Wave-0 Foundation Summary

**Typed /api/flow client + zod schemas (FlowRecord base64, Run*, 6-kind SSE payload) + flat {error} parser + openSseStream onOpen→X-Run-ID, plus a REST fetch-mock and a controllable fake SSE emitter scripting flowd's golden sequences — all unit-tested without a live flowd.**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-06-04T10:39Z
- **Completed:** 2026-06-04T10:48Z
- **Tasks:** 3
- **Files modified:** 10 (9 created, 1 modified)

## Accomplishments
- Extended `openSseStream` with an `onOpen(response)` hook (D-08) that preserves fetch-event-source's default open validation — a non-2xx / wrong-content-type open still throws (no silent swallow).
- Built the typed `/api/flow/*` client against the VERIFIED flowd contract: base64 decode-on-load, raw-flow PUT with id omitted, 204-delete-without-body, sync run, runs/run/events reads, and a FLAT `{error}` parser (`parseFlowdError`) distinct from Phase-2's gateway parser.
- Built `runStream`/`replayStream` that send NO auth/scope headers and surface flowd's `X-Run-ID` via `onRunId` exactly once.
- Landed the Wave-0 test harness: `installFlowdFetchMock` (204/400/409/404/500/empty-events) + `makeFakeSseStream` (four golden frame sequences + an open Response carrying `X-Run-ID` + onError/abort).
- `flowKeys` query-key factory + REST read hooks. Baseline preserved: 107 → 155 tests, all green; tsc/lint/build clean.

## Task Commits

Each task committed atomically (TDD: test+impl per task):

1. **Task 1: Flow zod schemas + flat flowd error parser** - `a5f1ff9` (feat; RED schemas.test.ts → GREEN schemas.ts + golden fixtures)
2. **Task 2: openSseStream onOpen + typed client + stream wrappers (X-Run-ID) + flowKeys** - `f3ec55a` (feat; RED client.test.ts → GREEN sse.ts/client.ts/stream.ts/queries.ts)
3. **Task 3: Test mock harness — REST fetch-mock + controllable fake SSE emitter** - `c8c9ff6` (test)

**Plan metadata:** _(this commit)_ (docs: complete plan)

## Files Created/Modified
- `web/src/lib/sse.ts` - **modified**: added `onOpen?(response)` to `SseStreamOptions`; wired fetch-event-source `onopen` to call `onOpen` then re-apply the default content-type open validation.
- `web/src/features/flow/api/schemas.ts` - zod schemas: flowMeta/flowRecord(base64 json string)/runMeta/runRecord/runEvent, `sseKindEnum` (6 kinds), `.loose()` `ssePayloadSchema`, FLAT `flowdErrorSchema` + inferred types.
- `web/src/features/flow/api/client.ts` - typed fetchers (plain fetch, no auth), `FlowdError` + `parseFlowdError`, `decodeFlowJson`, all REST endpoints.
- `web/src/features/flow/api/stream.ts` - `runStream`/`replayStream` over `openSseStream`, no auth, X-Run-ID→onRunId once.
- `web/src/features/flow/api/queries.ts` - `flowKeys` factory + 5 REST read hooks.
- `web/src/features/flow/api/schemas.test.ts` - 18 cases (golden DTO parse + malformed-error tolerance).
- `web/src/features/flow/api/client.test.ts` - 22 cases (base64 decode, PUT omits id, 204 delete, flat-error, sync run +/-, empty events, onRunId, no-auth headers).
- `web/src/test/mocks/flowd.ts` - golden REST fixtures + edge cases + `installFlowdFetchMock` (204-aware).
- `web/src/test/mocks/fetch-event-source.ts` - `makeFakeSseStream` + four golden sequences + late-join overlap fixtures.
- `web/src/test/mocks/fetch-event-source.test.ts` - 8 cases exercising the emitter surface.

## Decisions Made
- See `key-decisions` frontmatter. Headline: plain-fetch flowd client with zero auth headers; FLAT error envelope with its own parser; base64 decode in one helper; onOpen preserves default validation; onRunId fires once.

## Deviations from Plan

None - plan executed exactly as written. Two minor build-only adjustments (not behavior changes):
1. Removed a `Buffer` fallback in `decodeFlowJson`/`flowd.ts` after the production `tsc -b`/vite build flagged `Buffer` as undefined in the browser target — `atob`/`btoa` exist in both browser and jsdom, so the fallback was dead. (Rule 3 - blocking build error from my own code; fixed inline.)
2. Typed the fake `openSseStream` mock as an explicit callable (`OpenSseStreamMock`) so the build's `tsc -b` (stricter than `tsc --noEmit`) accepts direct calls. (Rule 3 - blocking; fixed inline.)

## Issues Encountered
- `tsc --noEmit` passed but `npm run build` (`tsc -b`) is stricter — caught the `Buffer` and `vi.fn` callable-widening issues that `--noEmit` did not. Resolved by running the full build as part of the gate, not just `--noEmit`.

## Known Stubs
None. All artifacts are fully wired and unit-tested. (The reducer/hook/UI that consume these contracts are intentionally out of scope — plans 03-02..05.)

## User Setup Required
None - no external service configuration required. (Manual end-to-end SSE-through-nginx verification against real flowd is deferred to the UI slices per 03-VALIDATION.md Manual-Only Verifications.)

## Next Phase Readiness
- Wave-0 foundation complete: the three vertical slices (03-02 CRUD, 03-03 streamed run + timeline reducer, 03-04 history, 03-05 replay) can consume the client/schemas/stream/queries + the mock harness directly with no re-derivation of the wire shape, base64 round-trip, SSE test seam, or X-Run-ID path.
- FLOW-01..06 remain open in REQUIREMENTS.md — they are delivered by the operator-facing UI slices, not this infra plan.
- Deferred (carried, not blocking): the live SSE-through-nginx e2e (closes Phase-1 BFF-03 Part 2) and the base64-vs-inline live-GET confirmation (A1) — both need a running flowd a unit test cannot supply.

## Self-Check: PASSED

All 10 artifacts exist on disk; all 3 task commits (`a5f1ff9`, `f3ec55a`, `c8c9ff6`) present in git history. Full suite 155 tests green; tsc/lint/build clean.

---
*Phase: 03-flow-console*
*Completed: 2026-06-04*
