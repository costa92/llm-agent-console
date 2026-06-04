---
phase: 03-flow-console
verified: 2026-06-04T12:10:00Z
status: partial
score: 6/6 success criteria automated-VERIFIED; 3 live-flowd gate items pending human
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
gaps: []
deferred:
  - truth: "Continuous mid-run live-FOLLOW after a fresh deep-link (vs events-so-far via replay)"
    addressed_in: "Phase 5 (SHELL-02 reconnect)"
    evidence: "03-CONTEXT.md D-deferred + STATE: auto-reconnect/backoff + reconnecting five-state is Phase 5; Phase 3 ships manual Retry + extensible connection machine."
human_verification:
  - test: "Live SSE through-nginx against REAL flowd (closes Phase-1 deferred BFF-03 Part 2)"
    expected: "With the compose stack up: trigger a streamed run; URL becomes /flows/{id}/runs/{runId} on X-Run-ID; frames flush incrementally (NOT batched) at the run sub-route; idle-survival across a slow node (raised proxy_read_timeout)."
    why_human: "Needs a running flowd + fronting nginx + a browser; Docker registry unreachable in sandbox. All keystone LOGIC is automated via golden-frame fixtures + the vi.mock fake SSE emitter — this gate proves the network/transport leg only."
  - test: "Deploy-environment SSE idle-timeout"
    expected: "Deploy LB/proxy idle timeout >= the longest silent node step (no heartbeat injected; flowd emits none)."
    why_human: "Environment-specific (Open Q2/A4)."
  - test: "FlowRecord.json base64-vs-inline against a live GET"
    expected: "curl .../api/flow/flows/{id} | jq .json confirms base64 (decodeFlowJson path)."
    why_human: "One-line empirical check against a live GET (Open Q1/A1); confirmed only against the golden fixture so far."
---

# Phase 3: Flow Console Verification Report

**Phase Goal:** An operator manages flows as JSON, triggers synchronous and streamed runs, watches a live append-only event timeline, and browses/replays past runs in that same renderer — proving SSE-through-BFF end-to-end.
**Verified:** 2026-06-04T12:10:00Z
**Status:** partial (6/6 success criteria VERIFIED in code with passing automated tests; 3 live-flowd gate items require a human, all backed by automated golden-fixture tests)
**Re-verification:** No — initial verification

## Build / Test Gate Results

| Gate | Command | Result |
| ---- | ------- | ------ |
| Type-check | `npx tsc --noEmit` (from `web/`) | ✓ EXIT 0 |
| Production build (STRICTER) | `npm run build` (`tsc -b && vite build`) | ✓ built, EXIT 0 |
| Unit/component tests | `npx vitest run` | ✓ 28 files, 228 tests passed |
| Lint | `npm run lint` | ✓ 0 errors (6 warnings — TanStack Table React-Compiler skip, not defects) |
| Backend regression | `GOWORK=off go build ./...` (repo root) | ✓ EXIT 0 |

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | List flows → open detail; create, edit (JSON validated + round-tripped on PUT), delete (confirm) | ✓ VERIFIED | `FlowsPage`→`FlowsTable` (row Link to `/flows/$flowId`) + `/flows/new`; `FlowDetailPage` full route w/ Tabs + `FlowEditor` (JSON.parse→zod ladder gates Save), `client.putFlow` OMITS id (test: `body).not.toHaveProperty('id')`), `createFlow`, `DeleteFlowDialog` red destructive + pessimistic navigate-on-204. |
| 2 | Sync run → outputs/result | ✓ VERIFIED | `RunTrigger` "Run (sync)" → `useSyncRun`→`client.runSync` POST `/flows/{id}/run`; `{outputs}` render into the shared `RunResultPanel` (D-04 one result surface). Test: client.test.ts run-sync + error. |
| 3 | Streamed run → live append-only timeline (node started/finished, terminal done/error), per-node status, auto-scroll pausing on manual scroll, visible connection state | ✓ VERIFIED | `RunTrigger` primary "Run" → `useRunStream.start` → on `X-Run-ID` navigates to run sub-route; `TimelineView` (append-only `events`, `NodeStatusList` per-node strip in-place, `ConnectionBadge` streaming/closed/errored, `useLayoutEffect` follow + scroll-listener pause + "Jump to latest"). Tests: TimelineView.test.tsx. |
| 4 | Browse run history + open run detail with status and timestamps | ✓ VERIFIED | Runs tab → `RunsHistory` react-table over `listRuns` (rows deep-link to run sub-route); `RunDetail` summary = `RunStatusBadge` + started_at/finished_at + inputs/outputs/error via RawJsonViewer. Tests: RunsHistory.test.tsx, RunDetail.test.tsx. |
| 5 | Browse a completed run's events + replay in the SAME renderer, late-join hydrated from /events then de-duped against live | ✓ VERIFIED (logic) / live-leg pending human | ONE pure `timelineReducer` serves live AND replay; `RunDetail.replay(runId)` instant-fills via `replayStream` (source:'history'); de-dup on `(kind,node,ordinal)`. Reducer tests prove: overlap-appears-once, idempotent re-hydrate (D-09), and replay render model === live render model. Live-through-nginx leg is the human gate. |

**Score:** 6/6 (5 ROADMAP criteria + FLOW-06 end-to-end intent) automated-VERIFIED; criterion-5/FLOW-06 live network leg pending the human gate.

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `timeline/reducer.ts` | Pure (kind,node,ordinal) de-dup reducer, live+replay | ✓ VERIFIED | 199 lines, per-source occurrence-index de-dup, terminal/outputs/error fold. Wired into useRunStream + tests. (Doc-rot — see below.) |
| `timeline/useRunStream.ts` | Imperative SSE hook; terminal+unmount abort; retry=/events-hydrate NOT re-POST | ✓ VERIFIED | start/replay/retry; abort on terminal (Pitfall 6) + unmount; retry() hydrates `listRunEvents` for known runId. Tests assert all. |
| `timeline/connection.ts` | Extensible conn machine streaming/closed/errored | ✓ VERIFIED | Typed union (not boolean), terminal-wins guard, late-error-after-closed ignored. |
| `api/stream.ts` | run/replay SSE wrappers; X-Run-ID once; NO auth headers | ✓ VERIFIED | `makeOnOpen` fires onRunId at most once; only Content-Type sent. |
| `api/client.ts` | base64 decode, PUT-omit-id, DELETE-204, flat {error}, empty /events | ✓ VERIFIED | `decodeFlowJson` (UTF-8 safe), `parseFlowdError` (flat, NOT gateway), `deleteFlow` no body parse, `listRunEvents` []-is-valid. |
| `lib/sse.ts` (onOpen) | onOpen surfaces Response then re-applies content-type validation | ✓ VERIFIED | onOpen → caller, then non-event-stream throws (no swallow). |
| `components/*` | TimelineView, NodeStatusList, ConnectionBadge, RunTrigger, RunDetail, RunResultPanel, FlowEditor, FlowsTable, RunsHistory, DeleteFlowDialog | ✓ VERIFIED | All substantive + wired + tested. |
| `app/routes/flow.tsx` (4 routes) | /flows, /flows/new, /flows/$flowId, /flows/$flowId/runs/$runId | ✓ VERIFIED | All 4 in `router.tsx` routeTree (D-08 sub-route is single live+replay location). |
| `test/mocks/{flowd,fetch-event-source}.ts` | Golden REST fixtures + base64 + fake SSE emitter | ✓ VERIFIED | flowd golden frames + base64-of-flowDefinition; controllable emitOpen/emit emitter. |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| RunTrigger | run sub-route | `navigate` on `onRunId`(X-Run-ID) — D-08 | ✓ WIRED |
| RunDetail | reducer | `useRunStream.replay` source:'history' instant-fill — D-07 | ✓ WIRED |
| useRunStream.retry | /events | `listRunEvents` hydrate (NOT re-POST /run/stream) — D-09/IC-6 | ✓ WIRED |
| TimelineView | retry() | amber "Connection lost" → onRetry — D-09 transport drop distinct from flow_err | ✓ WIRED |
| flow_err | timeline body | red terminal `FrameRow` "Flow failed — {error}." (kept partial) — D-09 | ✓ WIRED |
| client | flowd | same-origin `/api/flow/*`, NO Authorization / NO X-Console-* | ✓ WIRED (BFF injects) |

### Requirements Coverage

| Req | Description | Status | Evidence |
| --- | --- | --- | --- |
| FLOW-01 | List flows → row opens detail | ✓ SATISFIED | FlowsTable + Link, FlowsPage. |
| FLOW-02 | View/edit JSON, create, delete (confirm), validate + round-trip on PUT | ✓ SATISFIED | FlowEditor zod ladder + putFlow(omit id) + createFlow + DeleteFlowDialog. base64-vs-inline live-GET = human gate. |
| FLOW-03 | Sync run → outputs | ✓ SATISFIED | useSyncRun → runSync → RunResultPanel. |
| FLOW-04 | Streamed run → live timeline + per-node status + auto-scroll-pause + connection state | ✓ SATISFIED (logic); live network leg = human gate | TimelineView + NodeStatusList + ConnectionBadge + useRunStream; component tests. |
| FLOW-05 | Run history + run detail (status + timestamps) | ✓ SATISFIED | RunsHistory + RunDetail. |
| FLOW-06 | Browse events + replay in same renderer (SSE-through-BFF end-to-end) | ✓ SATISFIED (logic); end-to-end through real flowd = human gate | One reducer live+replay; de-dup tests; replay==live render identity test. |

### Decision Coverage (D-01..D-09)

| Decision | Status | Evidence |
| --- | --- | --- |
| D-01 timeline + node-status strip, same reducer | ✓ | TimelineView + NodeStatusList fed by reducer.nodeStatus. |
| D-02 connection-state badge, extensible | ✓ | ConnectionBadge + typed-union connReducer. |
| D-03 auto-scroll pause + jump-to-latest | ✓ | useLayoutEffect follow + scroll listener + pill. |
| D-04 streamed primary + sync secondary, ONE result surface | ✓ | RunTrigger two actions → shared RunResultPanel. |
| D-05 full-route detail + reused JSON editor + red delete | ✓ | FlowDetailPage Tabs + FlowEditor + DeleteFlowDialog. |
| D-06 PUT round-trip validated, id-mismatch, DELETE 204 | ✓ | putFlow omits id; deleteFlow 204 no-parse; tests. |
| D-07 instant-fill replay + history on detail | ✓ | RunsHistory on Runs tab + RunDetail.replay instant-fill. |
| D-08 deep-linkable run sub-route, single live+replay location | ✓ | runDetailRoute + navigate-on-X-Run-ID; RunDetailPage. |
| D-09 flow_err in-timeline vs transport drop errored+Retry | ✓ | FrameRow red terminal vs amber "Connection lost" Retry→/events hydrate. |

### Security

| Check | Status | Evidence |
| --- | --- | --- |
| Console sends NO bearer / NO X-Console-* | ✓ | grep: only comments + a test asserting `not.toHaveProperty('Authorization')` and no `x-console-*`. |
| flowd strings as TEXT nodes (no dangerouslySetInnerHTML) | ✓ | grep: zero occurrences (only a comment naming the rule). |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `timeline/reducer.ts` | ~13–14 | Doc-rot: header comment says "ordinal = the carried seq for history events" — contradicts implemented per-source `(kind,node)` occurrence-index de-dup (a later comment ~line 89 correctly says seq is NOT the ordinal). | ℹ️ Info | Non-blocking. Code + tests are correct; stale comment only. Recommend a one-line cleanup. |
| FlowsTable / RunsHistory / ResultsTable | — | `header.isPlaceholder` | none | TanStack Table API, not a stub. |

No TODO/FIXME/XXX/TBD/HACK/PLACEHOLDER debt markers in the flow feature.

### Human Verification Required

1. **Live SSE through-nginx against REAL flowd** (closes Phase-1 deferred BFF-03 Part 2) — with the compose stack up, trigger a streamed run; confirm URL → `/flows/{id}/runs/{runId}` on X-Run-ID, incremental (non-batched) flush at the sub-route, idle-survival across a slow node. *Why human:* needs running flowd + nginx + browser; Docker registry unreachable in sandbox.
2. **Deploy-environment SSE idle-timeout** — LB/proxy idle timeout >= longest silent node step (no heartbeat). *Why human:* environment-specific.
3. **FlowRecord.json base64-vs-inline against a live GET** — `curl .../api/flow/flows/{id} | jq .json`. *Why human:* confirmed only against golden fixture so far (A1).

### Gaps Summary

No code gaps. All 6 success criteria, 6 requirements, and 9 decisions are implemented, wired, and covered by passing automated tests (228 passing; tsc/build/lint/go-build clean). The keystone (one pure reducer for live+replay, `(kind,node,ordinal)` de-dup, connection machine, imperative useRunStream with terminal/unmount abort and /events-hydrate retry, D-08 sub-route, D-09 flow_err-vs-drop) is fully implemented and unit/component-tested without a live flowd, exactly as the validation architecture demands.

The phase is **partial** ONLY because the keystone's network leg — live SSE through real nginx→flowd — could not be exercised in the sandbox (compose stack down, registry unreachable). This is a tracked manual gate (also closing Phase-1's deferred BFF-03 Part 2), not a code defect. Recommend PASSED-with-tracked-followup once the three live-flowd checks are run in an environment with the compose stack.

One non-blocking doc-rot line in `timeline/reducer.ts` (~13–14) to clean up.

---

_Verified: 2026-06-04T12:10:00Z_
_Verifier: Claude (gsd-verifier)_
