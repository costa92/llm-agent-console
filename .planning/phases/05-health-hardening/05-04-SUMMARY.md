---
phase: 05-health-hardening
plan: "04"
subsystem: frontend/five-state-audit+reconnect-overlay
tags: [five-state-audit, reconnect-overlay, transient-overlay, connection-badge, typescript]
dependency_graph:
  requires: [05-03]
  provides: [five-state-audit-evidence, reconnect-overlay-flow, reconnect-overlay-chat]
  affects: [FlowsPage.test.tsx, TimelineView.tsx, RunDetail.tsx, ChatPage.tsx, ChatPage.reconnect.test.tsx]
tech_stack:
  added: []
  patterns: [five-state-audit, transient-overlay, prop-threading]
key_files:
  created:
    - web/src/features/flow/FlowsPage.test.tsx
    - web/src/features/chat/ChatPage.reconnect.test.tsx
  modified:
    - web/src/features/flow/components/TimelineView.tsx
    - web/src/features/flow/components/RunDetail.tsx
    - web/src/features/chat/ChatPage.tsx
decisions:
  - "D-04 five-state audit: FlowsPage→FlowsTable→FiveStateWrapper (loading/error/ready+empty) CONFORMS; RunDetailPage→RunDetail→FiveStateWrapper CONFORMS; ChatPage inline five states (EmptyConversation/Thinking…/Failed/droppedTransport/done) CONFORMS — no production code change required for conformance, only FlowsPage.test.tsx added as audit evidence"
  - "IC-4 overlay threading path: useRunStream.attempt/cap → RunDetail (destructure) → TimelineView (new props attempt?/cap?) → ConnectionBadge (forward) — enables Reconnecting (n/N)... badge label"
  - "Chat overlay symmetry: reconnecting subline added to AssistantBubble for conn==='reconnecting' (TEXT node); in practice never reached due to D-03 manual-retry-only refinement; droppedTransport convenience variable removed (orphan after split)"
  - "Four-signal distinction maintained: green Streaming / amber-spinning Reconnecting(n/N)... / amber-static Connection lost / red in-content Failed — mutually exclusive and operator-readable"
metrics:
  duration: 22min
  completed: "2026-06-09"
  tasks_completed: 2
  files_changed: 5
---

# Phase 5 Plan 04: Five-State Audit + Reconnecting Overlay Summary

Five-state audit confirmed conformance across all three gap-candidate pages (FlowsPage / RunDetailPage / ChatPage) with FlowsPage.test.tsx added as audit evidence; transient reconnecting overlay wired on the flow timeline (attempt/cap threaded useRunStream → RunDetail → TimelineView → ConnectionBadge) and chat (symmetry subline); four transport/result signals stay mutually distinct.

## What Was Built

### Task 1: Five-State Audit + FlowsPage Test

**Audit findings (D-04 / IC-5 — code conformance, no visual redesign):**

| Page | Delegated To | Coverage | Outcome |
|------|-------------|----------|---------|
| FlowsPage | FlowsTable → FiveStateWrapper | loading / error / ready; NoFlowsEmptyState inline for zero results | **CONFORMS — no production change** |
| RunDetailPage | RunDetail → FiveStateWrapper | loading / error / ready; NoEventsEmptyState inline | **CONFORMS — no production change** |
| ChatPage | Inline states | EmptyConversation (empty); Thinking… (partial/streaming); in-bubble Failed (error); droppedTransport (errored); done | **CONFORMS — inline equivalent per IC-5; no FiveStateWrapper required** |

**FlowsPage.test.tsx (4 tests):** loading → "Loading…" / empty → "No flows yet." / error → "500 from flowd — …" / ready → rows visible. Proves no blank panel in any state (D-04 evidence).

### Task 2: Reconnecting Overlay

**RunDetail.tsx:** Extended destructure to `{ timeline, conn, attempt, cap }` and forwarded `attempt={attempt} cap={cap}` on the existing `<TimelineView />` call.

**TimelineView.tsx:**
- Added `attempt?: number` and `cap?: number` to `TimelineViewProps`
- Forwarded into `<ConnectionBadge conn={conn} attempt={attempt} cap={cap} />` → renders "Reconnecting (n/N)…" when conn==='reconnecting'
- Added transient reconnecting subline (`data-slot="reconnecting-subline"`) beneath the partial timeline when `conn === 'reconnecting'`: "Connection dropped — reconnecting… (attempt {n} of {N})." — TEXT node (T-V5); the partial timeline STAYS visible above it
- Existing `conn === 'errored'` "Connection lost" + Retry treatment kept unchanged

**ChatPage.tsx:**
- Split the `droppedTransport` convenience variable (which was `reconnecting || errored`) into two explicit conditions:
  - `conn === 'reconnecting'`: new reconnecting subline (`data-slot="reconnecting-subline"`) — amber muted, for symmetry with flow; never reached in practice due to D-03 manual-retry-only refinement
  - `conn === 'errored'`: existing "Connection dropped before the reply finished." amber line (kept)
- Removed the now-orphaned `droppedTransport` variable (Rule 3)

**ChatPage.reconnect.test.tsx (4 tests):**
1. Transport drop → partial trace stays + "Connection lost" badge (errored, D-03 refinement) + muted dropped line
2. Four signals mutually distinct: Streaming → Connection lost (no conflation with Failed)
3. In-content error frame (red Failed) is separate from amber transport drop
4. Streaming badge is data-conn="streaming" (green), not amber

## Verification Results

| Check | Result |
|-------|--------|
| `npx vitest run src/features/flow/FlowsPage.test.tsx` | 4 / 4 PASS |
| `npx vitest run src/features/chat/ChatPage.reconnect.test.tsx` | 4 / 4 PASS |
| `npx vitest run src/features/flow src/features/chat src/features/memory` | 269 / 269 PASS |
| `npx vitest run` (full suite) | 308 / 308 PASS (was 300/300 before phase 5) |
| `npx tsc -b` | clean (zero errors) |
| `npm run lint` (all files) | 0 errors, 6 warnings (pre-existing TanStack Table react-hooks/incompatible-library) |
| `npm run build` | 726kB bundle, 0 errors |

## Deviations from Plan

### None (plan executed as written)

The audit confirmed all three gap pages are already conformant — no production code fix was needed beyond FlowsPage.test.tsx (the plan anticipated this: "Confirm conformance; add a component test proving the states render. Likely no code change."). All changes are confined to the plan's `files_modified` list.

**droppedTransport variable removal:** This was a Rule-3 cleanup — splitting `droppedTransport = reconnecting || errored` into two distinct conditions made the variable an orphan. Removed per the "clean up your own orphans" rule.

## Known Stubs

None — no placeholder data, TODO comments, or unconnected UI. The reconnecting subline in ChatPage will never render in practice (D-03 manual-retry-only refinement) but is wired code, not a stub.

## Threat Flags

None — this plan introduces no new network endpoints, no auth paths, no file access patterns. All health/reconnect/state strings render as TEXT nodes (T-V5 verified: `data-slot="reconnecting-subline"` both in TimelineView and ChatPage). The overlay is purely presentational — it does not change transport or reconnect behavior.

## Self-Check

- [x] `web/src/features/flow/FlowsPage.test.tsx` exists — 4 tests (loading/empty/error/ready)
- [x] `web/src/features/chat/ChatPage.reconnect.test.tsx` exists — 4 tests
- [x] `web/src/features/flow/components/TimelineView.tsx` contains `reconnecting` + `attempt` + `cap`
- [x] `web/src/features/flow/components/RunDetail.tsx` contains `attempt` (destructured from useRunStream)
- [x] `web/src/features/chat/ChatPage.tsx` contains `reconnecting-subline` data-slot
- [x] Commit `68b0fad` exists (task 1: FlowsPage.test.tsx)
- [x] Commit `29037dc` exists (task 2: overlay + ChatPage.reconnect.test.tsx)
- [x] 308 / 308 tests pass, `tsc -b` clean, build clean

## Self-Check: PASSED
