# Phase 3: Flow Console - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 3-flow-console
**Areas discussed:** Live timeline layout, Run trigger UX, Flow CRUD + JSON editor, Run history + replay, Run view URL structure, Stream error handling

---

## Live timeline layout (keystone)

| Option | Description | Selected |
|--------|-------------|----------|
| Timeline + node-status strip | append-only event timeline + per-node status strip updating in place + connection-state badge + auto-scroll-pause | ✓ |
| Event-log only | just the vertical timeline; status read from log | |
| Node-status board only | nodes as rows updating; no raw event log | |

**User's choice:** Timeline + node-status strip → **D-01/D-02/D-03**

---

## Run trigger UX (sync vs streamed)

| Option | Description | Selected |
|--------|-------------|----------|
| Streamed primary + sync secondary, one result surface | primary Run streams; secondary Run (sync); sync result reuses the terminal-frame/result panel | ✓ |
| Two equal buttons | Run / Run streamed equally prominent | |
| Streamed only + sync as quick-run | run view pure-streaming; sync separate | |

**User's choice:** Streamed primary + sync secondary → **D-04**

---

## Flow CRUD + JSON editor

| Option | Description | Selected |
|--------|-------------|----------|
| Full-route flow detail + reused JSON editor | /flows/{id} route hosts reused raw-JSON+zod editor + run controls + history | ✓ |
| Drawer detail (mirror Phase-2) | flows list + side-drawer detail | |
| Split: list+editor drawer, separate run view | CRUD in drawer, run in separate page | |

**User's choice:** Full-route flow detail → **D-05/D-06**

---

## Run history + replay

| Option | Description | Selected |
|--------|-------------|----------|
| Instant-fill replay + history on flow detail | history react-table on flow detail; open run instant-fills timeline (no playback); same renderer; de-dupe (kind,node,ordinal) | ✓ |
| Auto-play replay | re-animate events over time | |
| Instant-fill, history as separate Runs page | same fill, history on its own page | |

**User's choice:** Instant-fill replay + history on flow detail → **D-07**

---

## Run view URL structure (follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| Deep-linkable run sub-route | /flows/{id}/runs/{runId}; live + replay both render here, shareable; relieves the flow-detail route | ✓ |
| Inline on flow detail, no run URL | timeline as component state, not in URL | |

**User's choice:** Deep-linkable run sub-route → **D-08**

---

## Stream error handling (follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| Distinguish them | flow_err = terminal error frame in-timeline; transport drop = errored badge + manual Retry; state machine extends for Phase 5 | ✓ |
| Treat both as generic error | one error state + Retry for any error | |

**User's choice:** Distinguish them → **D-09**

---

## Claude's Discretion

- The (kind,node,ordinal) de-dupe + single timeline reducer (research-specified; planner unit-tests).
- base64 FlowRecord.json decode/encode (research-flagged A1).
- flat flowd error-envelope parser (do NOT reuse Phase-2 parseGatewayError).
- exact auto-scroll-pause + node-status-strip + connection-badge visuals (per UI-SPEC).
- editor reuse: Phase-2 EditorDrawer vs route-hosted raw-JSON+zod variant (pattern locked, component choice open).

## Deferred Ideas

- Auto-reconnect/backoff + SSE disconnected/reconnecting state — Phase 5.
- Visual DAG / drag-and-drop builder — v1 out of scope.
- Auto-play (timed) replay — not chosen (instant-fill).
- Cross-flow Runs page — not chosen (history local to flow detail).
