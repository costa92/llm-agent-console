---
phase: 3
slug: flow-console
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-04
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `03-RESEARCH.md` §Validation Architecture (verified against the flowd contract).
> Central concern: the keystone SSE logic must be provable **without a live flowd**.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.x + @testing-library/react (established Phase 1, used Phase 2) |
| **Config file** | reuse `web/` setup — no framework install |
| **Quick run command** | `cd web && npx vitest run src/features/flow` |
| **Full suite command** | `cd web && npx vitest run` |
| **Estimated runtime** | ~20 seconds |

---

## How to test the imperative SSE client deterministically (the central concern)

1. **Pure reducer + connection machine (no I/O):** unit-test `timelineReducer` + the connection-state machine as pure functions over `{kind,payload}` fixtures from flowd's `server_events_test.go` golden sequences (success / `flow_err` / `node_skipped`). No mock — feed events, assert render model + per-node status + terminal + de-dup.
2. **Imperative hook (`useRunStream`) with a fake SSE source:** `vi.mock('@microsoft/fetch-event-source')` (or the `openSseStream` wrapper) returning a controllable emitter; push scripted frames + an open Response carrying an `X-Run-ID` header + optional onerror/abort. Assert in-order dispatch, `X-Run-ID` surfaces via onRunId, terminal flips connection state + aborts, unmount aborts, and the transport-drop `retry()` hydrates `GET /events` + de-dups (NOT a fresh `/run/stream`). Mock the wrapper + `listRunEvents`, not the network.
3. **De-dup (most important):** history `[1,2,3]` + live tail `[3,4,5]` → merged `[1,2,3,4,5]` with the overlap appearing once (success criterion 5); also covers the live-resume `/events` hydrate.
4. **Auto-scroll-pause:** RTL component test — assert auto-scroll *intent* (scroll-to-bottom called when not paused, skipped when paused); jsdom has no layout, stub `scrollTo` (Phase-1 precedent).
5. **Live-run deep-link (D-08):** the streamed Run trigger navigates to `/flows/{id}/runs/{runId}` on `X-Run-ID`; the run sub-route is the single live+replay render location — assert the navigate spy fires with the runId and the sub-route mounts the timeline.

---

## Per-Task Verification Map

> Task IDs assigned by the planner; rows keyed to requirements + behavior (RESEARCH §Phase Requirements → Test Map).
> FLOW-03 = SYNCHRONOUS run; FLOW-04 = STREAMED run (per REQUIREMENTS.md — authoritative).

| Req | Slice | Behavior under test | Threat Ref | Test Type | Automated Command | File Exists | Status |
|-----|-------|---------------------|------------|-----------|-------------------|-------------|--------|
| FLOW-01 | A (CRUD) | Flows list renders rows; row → detail nav | — | component | `vitest run src/features/flow/components/FlowsTable.test.tsx` | ❌ W0 | ⬜ pending |
| FLOW-02 | A | Editor base64-decodes on load; PUT round-trips; zod rejects malformed JSON; compile-400 → toast | T-V5 | component+unit | `vitest run src/features/flow/components/FlowEditor.test.tsx` | ❌ W0 | ⬜ pending |
| FLOW-02 | A | Delete shows red confirm; treats 204 as success (no body parse) | — | component | `vitest run src/features/flow/components/FlowEditor.test.tsx` | ❌ W0 | ⬜ pending |
| FLOW-03 | B | Sync run renders `{outputs}`; failure renders `error` | — | unit | `vitest run src/features/flow/api/client.test.ts` | ❌ W0 | ⬜ pending |
| FLOW-04 | B (keystone) | Reducer: 6-kind golden sequence → render model + per-node status + terminal | — | unit | `vitest run src/features/flow/timeline/reducer.test.ts` | ❌ W0 | ⬜ pending |
| FLOW-04 | B | Connection machine: streaming→closed on flow_done, →errored on flow_err/onError; unmount aborts | — | unit | `vitest run src/features/flow/timeline/connection.test.ts` | ❌ W0 | ⬜ pending |
| FLOW-04 | B | Imperative `useRunStream` dispatches scripted frames; terminal aborts; X-Run-ID surfaces via onRunId; transport-drop retry hydrates /events + de-dups | T-stream-auth | unit | `vitest run src/features/flow/timeline/useRunStream.test.ts` | ❌ W0 | ⬜ pending |
| FLOW-04 | B | Auto-scroll pauses on manual scroll-up; jump-to-latest resumes | — | component | `vitest run src/features/flow/components/TimelineView.test.tsx` | ❌ W0 | ⬜ pending |
| FLOW-04 | B | flow_err = terminal frame in-timeline; transport drop = errored badge + manual Retry→onRetry (D-09) | — | component | `vitest run src/features/flow/components/TimelineView.test.tsx` | ❌ W0 | ⬜ pending |
| FLOW-04 | B/C | Live streamed Run navigates to /flows/{id}/runs/{runId} on X-Run-ID (D-08) | T-03-12 | component | `vitest run src/features/flow/components` | ❌ W0 | ⬜ pending |
| FLOW-05 | C | Runs history renders status+timestamps; row → run sub-route nav | — | component | `vitest run src/features/flow/components/RunsHistory.test.tsx` | ❌ W0 | ⬜ pending |
| FLOW-06 | C | Replay feeds the SAME reducer → identical render to live | — | unit | `vitest run src/features/flow/timeline/reducer.test.ts` | ❌ W0 | ⬜ pending |
| FLOW-06 | C | Late-join de-dup: history[1,2,3] + live[3,4,5] → [1,2,3,4,5] (kind,node,ordinal) | — | unit | `vitest run src/features/flow/timeline/reducer.test.ts` | ❌ W0 | ⬜ pending |
| FLOW-05 | C | Run sub-route is the single live+replay render location; empty `/events` → empty state, not error | — | component | `vitest run src/features/flow/components/RunDetail.test.tsx` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/sse.ts` — extend `openSseStream` with an `onOpen(response)` hook so callers can read SSE response headers (incl. `X-Run-ID`)
- [ ] `src/features/flow/api/schemas.ts` — zod fixtures from the verified DTO shapes (FlowRecord incl. base64 `json`, RunMeta, RunRecord, RunEvent, the 6-kind SSE payload)
- [ ] `src/test/mocks/flowd.ts` — fetch-mock handlers for `/api/flow/*` REST (incl. a 400 compile error, a 204 delete, an empty `/events`, flat `{error}` envelope)
- [ ] `src/test/mocks/fetch-event-source.ts` — controllable fake SSE emitter (`vi.mock('@microsoft/fetch-event-source')`) scripting the golden frame sequences (success, failure, node_skipped, late-join overlap) AND supplying an open Response with an `X-Run-ID` header
- [ ] Reuse the Phase-1 QueryClient test wrapper + jsdom `scrollTo` stub (do NOT re-create)

*Vitest + RTL + QueryClient wrapper established Phase 1, exercised Phase 2 — only flow-specific fixtures/mocks/test files are new. No framework install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| **Live SSE through-nginx against real flowd** (closes Phase-1 BFF-03 Part 2) | FLOW-04/06 | Needs a running flowd + the fronting nginx + a browser; Docker registry unreachable in this sandbox | With the compose stack up: trigger a streamed run; confirm the URL becomes `/flows/{id}/runs/{runId}` on `X-Run-ID` and per-event flush (frames appear incrementally, not batched) at the run sub-route, plus idle-survival across a slow node (raised `proxy_read_timeout`) |
| Deploy-environment SSE idle-timeout | FLOW-04 | Environment-specific (Open Q2/A4) | Verify the deploy LB/proxy idle timeout ≥ the longest silent node step |
| `FlowRecord.json` base64 vs inline | FLOW-02 | One-line empirical check against a live GET (Open Q1/A1) | `curl .../api/flow/flows/{id} | jq .json` — confirm base64; wire the editor decode accordingly |

*The reducer, de-dup, connection machine, X-Run-ID surfacing, transport-drop /events hydrate, and auto-scroll-pause are fully automated above; these three need a live flowd a unit test can't supply.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
</content>
</invoke>
