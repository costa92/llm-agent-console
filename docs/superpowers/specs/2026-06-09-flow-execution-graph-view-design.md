# Flow Execution Graph View — Design

**Date:** 2026-06-09
**Status:** Approved (design); ready for implementation
**Area:** `web/src/features/flow` (Flow run page)

## Problem

The Flow run page (`/flows/{flowId}/runs/{runId}`) shows per-node status as a **flat strip** (`NodeStatusList`) plus a vertical event log (`TimelineView`). Neither shows **topology** — which node connects to which, the path taken, or where execution currently is *on the graph*. An operator cannot see "from which node to which node, and where execution is now" at a glance.

## Goal

A read-only **execution graph** on the run page that renders the flow's nodes + edges, colors each node by run status, and highlights the current (running) node — making the execution path and live position obvious.

## Decisions (locked)

- **Rendering:** `@xyflow/react` (react-flow) v12.x. Verified: peer `react >=17` (our React is 19.2.6), installs cleanly. Provides pan/zoom + minimap.
- **Placement:** the graph **replaces `NodeStatusList`**, sitting **above** `TimelineView` in `RunDetail`. The graph answers "path/position"; the timeline below stays for event detail. `NodeStatusList` is **kept as the fallback** when the flow IR can't be fetched.
- **Layout:** a small **pure helper** (`layoutGraph.ts`) computes node x/y via a topological layered layout. No dagre/elk dependency — flows are small DAGs.

## Data sources (no backend change — both already exist)

- **Topology** `{ nodes, edges }`: `getFlow(flowId)` via the existing `flowDetailQuery` (`api/queries.ts`); `RunDetailPage`/`RunDetail` already have `flowId`. `getFlow` base64-decodes the IR.
- **Run status / current position:** the reducer's existing `nodeStatus: Record<string, NodeStatus>` (`pending|running|done|skipped|errored`) from `timeline/reducer.ts`. `running` = the live current node. The same map drives the chips today and works identically for **live stream and replay**.

## Components / units

1. **`layoutGraph.ts`** (pure) — input: IR `nodes[]` + `edges[]`; output: `{ id, x, y }[]` + edge list. Topological layered layout (rank by longest-path from sources; spread siblings within a rank). Unit-testable in isolation. No React, no react-flow.
2. **`flowGraphStatus.ts`** (pure, or co-located) — maps `NodeStatus → { token, Icon, emphasis }`, reusing the exact tokens/icons from `NodeStatusList`/`FRAME_META` (pending=slate dashed · running=slate + spinner + **pulsing ring** · done=green check · skipped=dim · errored=red x). Single source of truth shared by the strip and the graph node.
3. **`FlowGraphNode.tsx`** — custom react-flow node: a box with the node id (TEXT), status icon+color, pulsing ring when `running`.
4. **`FlowGraph.tsx`** — composes react-flow: builds RF `nodes`/`edges` from `layoutGraph` output + `nodeStatus`, renders `<ReactFlow>` read-only (`nodesConnectable={false}`, `fitView`, minimap, pan/zoom). Props: `{ ir: {nodes,edges}, nodeStatus, terminal }`.

## Data flow

```
RunDetail(flowId, runId)
  ├─ useRunStream(...)  → timeline.nodeStatus  ──┐
  ├─ useQuery(flowDetailQuery(flowId)) → ir      │
  │     ├─ success → <FlowGraph ir nodeStatus/>  │ (above timeline)
  │     ├─ pending → compact skeleton            │
  │     └─ error   → <NodeStatusList> (fallback) ┘
  └─ <TimelineView .../>   (unchanged, below)
```

`nodeStatus` is a prop into `FlowGraph`; React re-renders node colors as stream events arrive. Replay uses the same `nodeStatus` map → identical behavior.

## Error handling / edge cases

- **IR fetch pending** → compact skeleton in the graph slot (timeline still works).
- **IR fetch error** → fall back to `NodeStatusList` (kept for this); run view never regresses.
- **Node in `nodeStatus` not in IR** (or vice versa) → render the **union**; status-only nodes get a default position appended after the laid-out ranks.
- **Empty/one-node flow** → single node centered, no edges.

## Testing

- `layoutGraph.test.ts` — pure: chain (upper→reverse) ranks 0,1; branch (classify→{greet,other}) places siblings; cycle-guard / unknown-edge tolerance.
- `flowGraphStatus.test.ts` — each `NodeStatus` maps to the expected token/icon/emphasis; parity with `NodeStatusList`.
- `FlowGraph.test.tsx` — render a 2-node IR + `nodeStatus` map; assert nodes show correct status classes, the `running` node has the current-position highlight, edges present. react-flow needs `ResizeObserver` + element dimensions in jsdom → add a test shim (standard RF+vitest pattern) in setup.

## Scope (YAGNI)

- Run-view only — **not** the flow editor.
- Read-only — no editing/connect, no custom controls beyond RF defaults (pan/zoom/minimap).
- Custom layered layout — no dagre/elk.
- New dependency: **`@xyflow/react` only**.

## Out of scope

- Editing the graph; live graph in the editor; per-edge event payloads on the graph (timeline already shows payloads); auto-fit animations beyond `fitView`.
