---
phase: 03-flow-console
plan: 02
subsystem: flow-ui
tags: [flow, crud, react-table, tanstack-router, tabs, base64, zod, destructive-dialog, vitest]

# Dependency graph
requires:
  - phase: 03-flow-console
    provides: "03-01 typed /api/flow client (listFlows/getFlow base64-decode/createFlow/putFlow id-omit/deleteFlow 204) + flowKeys + read hooks + parseFlowdError + installFlowdFetchMock"
  - phase: 02-memory-console
    provides: "EditorDrawer raw-JSON+zod pattern, ResultsTable react-table pattern, LifecycleActions red destructive-dialog pattern, FiveStateWrapper, CopyableId, sonner toast"
  - phase: 01-foundation
    provides: "TanStack Router shell + NavBar, FiveStateWrapper / CopyableId primitives, dark operator theme"
provides:
  - "Flows list route /flows (react-table over GET /flows: flow.id CopyableId, name fallback-to-id, created/updated_at mono) + FLOW-specific empty state + verbatim flowd error + row->detail nav"
  - "Flow detail route /flows/{id} with shadcn Tabs (Definition / Runs) over useFlowQuery five-state"
  - "Route-hosted raw-JSON+zod FlowEditor (create + edit modes; base64 decode-on-load, raw-flow + id-omit PUT, create POST->201->/flows/{newId})"
  - "useFlowMutations: usePutFlow / useCreateFlow / useDeleteFlow (terse success toast, verbatim flowd flat-error failure toast, flowKeys invalidation)"
  - "DeleteFlowDialog: Phase-1 red destructive confirm; 204=success -> toast + route to /flows; failure -> verbatim toast + no nav"
  - "Run-trigger + run-history placeholder slots (Definition / Runs tabs) for 03-04 / 03-05"
affects: [03-04 streamed run + run-trigger slot, 03-05 run history + Runs tab slot]

# Tech tracking
tech-stack:
  added:
    - "shadcn tabs block (copy-in, official registry, no npm runtime dep — T-03-SC)"
  patterns:
    - "Flow detail is a FULL ROUTE (not a search-param drawer) with /flows/new + /flows/$flowId — D-05/IC-1"
    - "One route-hosted editor, two modes: edit seeds the base64-DECODED flow IR (parent decodes via getFlow), create seeds {id,nodes,edges} skeleton"
    - "PUT sends raw flow + OMITS id (client-enforced, Pitfall 4); DELETE 204=success no-parse (Pitfall 5)"
    - "FLOW-specific empty state rendered inside the FiveStateWrapper ready-slot (NOT its generic unset-context EmptyState — that is the MEM-08 gate; flowd has no context gate)"
    - "flowd flat {error} surfaces verbatim in toasts/error states (BFF-04 passthrough); all flowd strings render as React TEXT nodes (T-03-V5)"

key-files:
  created:
    - web/src/features/flow/components/FlowsTable.tsx
    - web/src/features/flow/components/FlowsTable.test.tsx
    - web/src/features/flow/components/FlowEditor.tsx
    - web/src/features/flow/components/FlowEditor.test.tsx
    - web/src/features/flow/components/DeleteFlowDialog.tsx
    - web/src/features/flow/hooks/useFlowMutations.ts
    - web/src/features/flow/FlowsPage.tsx
    - web/src/features/flow/FlowDetailPage.tsx
    - web/src/components/ui/tabs.tsx
  modified:
    - web/src/app/routes/flow.tsx
    - web/src/app/router.tsx
    - web/src/components/shell/NavBar.tsx

key-decisions:
  - "Flow detail is three full routes (/flows, /flows/new, /flows/$flowId) registered in the routeTree; replaced the /flow Phase-1 placeholder (NavBar now points at /flows)"
  - "FlowEditor consumes the ALREADY-decoded flow IR as a prop in edit mode (FlowDetailPage's useFlowQuery/getFlow runs the single decodeFlowJson site, A1) — the textarea never holds base64"
  - "Well-formedness gate is z.looseObject({}) (flow must be a JSON object); flowd remains the AUTHORITATIVE semantic validator (compile 400 surfaced verbatim) — the client only checks JSON well-formedness pre-submit"
  - "Delete is pessimistic: navigate to /flows only after the 204 (D-11); a failure stays on the detail and shows the verbatim flowd error"
  - "FlowsTable renders its FLOW-specific empty state inside the ready slot so it never collides with FiveStateWrapper's generic unset-context EmptyState"

requirements-completed: [FLOW-01, FLOW-02]

# Metrics
duration: 9min
completed: 2026-06-04
---

# Phase 3 Plan 02: Flow CRUD (Slice A) Summary

**Flows list (react-table) -> /flows/{id} detail with Definition/Runs tabs + a route-hosted raw-JSON+zod editor (base64 decode-on-load, raw-flow + id-omit PUT, create POST->201->new flow) + a red delete-confirm (204=success -> route back), all reusing the Phase-2 patterns and surfacing flowd's flat {error} verbatim — no SSE in this slice.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-06-04T03:05Z
- **Completed:** 2026-06-04T03:14Z
- **Tasks:** 3
- **Files modified:** 12 (9 created, 3 modified)

## Accomplishments
- **Flows list (S1 / FLOW-01):** `FlowsTable` is a client-side `@tanstack/react-table` over `useFlowsQuery()` (columns: `flow.id` CopyableId mono · name sans fallback-to-id · created/updated_at mono), wrapped in the Phase-1 five-state primitive with a FLOW-specific "No flows yet." empty state + New-flow CTA and a verbatim "{status} from flowd — {error}." error state; row click navigates to `/flows/{id}`. `FlowsPage` hosts the title + the accent New-flow button. NavBar's Flow link now points at `/flows`.
- **Flow detail (S2 / FLOW-01/02):** `FlowDetailPage` is a full route with shadcn `Tabs` (Definition / Runs) over `useFlowQuery` five-state. Definition hosts the editor + the delete control + a run-trigger placeholder slot (03-04); Runs hosts a run-history placeholder slot (03-05). Create mode (`/flows/new`) renders the editor blank/templated directly (no GET).
- **JSON editor (S3 / FLOW-02 / IC-2):** `FlowEditor` reuses the Phase-2 raw-JSON + zod ladder as a route-hosted mono textarea. Edit mode seeds the base64-DECODED flow IR (the parent's `getFlow` runs the single `decodeFlowJson` site — the textarea never shows `eyJ…`); create seeds a `{id,nodes,edges}` skeleton. Save (accent) is disabled while unparseable; PUT sends the raw flow with `id` omitted (Pitfall 4); create POST -> 201 -> navigates to `/flows/{newId}`. All flowd strings render as TEXT nodes (T-03-V5).
- **Mutations:** `useFlowMutations` (`usePutFlow` / `useCreateFlow` / `useDeleteFlow`) fire terse success toasts ("Flow saved." / "Flow created." / "Flow deleted.") and the Phase-1 failure toast "{Action} failed — {status}: {verbatim flowd message}." + Copy-error, invalidating `flowKeys`.
- **Delete (Task 3 / IC-1):** `DeleteFlowDialog` is the Phase-1 red destructive confirm — "Delete flow?" naming the id + run history + irreversibility, Confirm repeats the verb (destructive red), Cancel default-focused. A 204 is success (no body parse, Pitfall 5) -> toast + pessimistic nav to `/flows`; a failure (e.g. 404) surfaces verbatim and stays on the detail.
- **Tests:** 16 new cases (FlowsTable 6, FlowEditor 7, DeleteFlowDialog 3). Full suite 186 -> 202 green; flow subtree 87 green; tsc/build/lint all clean.

## Task Commits

1. **Task 1: Flows list table + /flows routes + NavBar wiring** — `21161fd` (feat)
2. **Task 2: Flow detail tabs + route-hosted JSON editor (base64 round-trip) + mutations** — `6d13f37` (feat)
3. **Task 3: Red delete-flow confirm dialog (204=success route to /flows)** — `4cf2081` (feat)

**Plan metadata:** _(this commit)_ (docs: complete plan)

## Files Created/Modified
- `web/src/features/flow/components/FlowsTable.tsx` — react-table over GET /flows + FLOW empty/error states + row->detail nav.
- `web/src/features/flow/components/FlowsTable.test.tsx` — 6 cases (rows/empty/error/row-nav/new-nav/XSS-text).
- `web/src/features/flow/components/FlowEditor.tsx` — route-hosted raw-JSON+zod editor, create+edit, base64 round-trip, PUT id-omit.
- `web/src/features/flow/components/FlowEditor.test.tsx` — 10 cases (edit base64-decode/parse-disable/PUT-omits-id/400-verbatim, create skeleton+POST->nav, name-as-text, +3 delete).
- `web/src/features/flow/components/DeleteFlowDialog.tsx` — Phase-1 red destructive confirm; 204=success->toast+nav; failure->verbatim toast+stay.
- `web/src/features/flow/hooks/useFlowMutations.ts` — usePutFlow / useCreateFlow / useDeleteFlow + flowKeys invalidation + verbatim flowd toasts.
- `web/src/features/flow/FlowsPage.tsx` — Flows page title + New-flow CTA + FlowsTable.
- `web/src/features/flow/FlowDetailPage.tsx` — detail route, shadcn Tabs (Definition/Runs), editor + delete + placeholder slots.
- `web/src/components/ui/tabs.tsx` — shadcn tabs block (the one new copy-in block).
- `web/src/app/routes/flow.tsx` — **modified**: real flowsRoute/flowNewRoute/flowDetailRoute (replaced the /flow placeholder).
- `web/src/app/router.tsx` — **modified**: register the three flow routes.
- `web/src/components/shell/NavBar.tsx` — **modified**: Flow nav link /flow -> /flows.

## Decisions Made
See `key-decisions` frontmatter. Headline: full-route flow detail (3 routes); the editor consumes the already-decoded flow IR (single decode site, A1); well-formedness-only client gate with flowd as the authoritative validator; pessimistic delete nav after the 204; FLOW-specific empty state inside the ready slot.

## Deviations from Plan

None affecting behavior. Two minor in-scope adjustments:
1. **[Rule 3 - blocking] FlowsTable empty state:** the plan's wording implied passing `empty` to FiveStateWrapper, but that primitive's EmptyState is the MEM-08 unset-context one ("No operator context set" + "Set context"). I render the FLOW-specific "No flows yet." empty state inside the ready slot instead (flowd has no context gate). Matches UI-SPEC copy exactly; no extra surface.
2. **[Rule 3 - blocking] DeleteFlowDialog ordering:** FlowDetailPage (Task 2) imports DeleteFlowDialog (a Task 3 file), so Task 2 committed a placeholder and Task 3 filled it. Kept each task building + lint-clean independently.

## Issues Encountered
- Two test-harness nits (fixed inline, not behavior): create-mode tests needed an `await screen.findByLabelText` before reading the textarea (router not yet idle synchronously); and the shared `toast.error` spy accumulates across tests in a module, so the failure-toast assertions use `toHaveBeenCalledWith(..., expect.anything())` (+ `mockClear`) rather than `mock.calls[0]`.

## Known Stubs
- **Run-trigger placeholder slot** (Definition tab) — intentional; filled by **03-04** (streamed run + run trigger). Documented in `FlowDetailPage.tsx`.
- **Run-history placeholder slot** (Runs tab) — intentional; filled by **03-05** (run history). Documented in `FlowDetailPage.tsx`.

These are the planned Slice-A boundaries (no SSE in this slice), not unwired data: the CRUD surface (list/detail/editor/delete) is fully functional against the real `/api/flow/*` client. The live TimelineView is deliberately NOT mounted here (D-08 — it renders at the run sub-route in 03-04/03-05).

## Deferred / Manual-Only Verifications
- **A1 (base64 decode-on-load against a live GET):** the editor decode path is unit-verified against the golden `flowJsonBase64` fixture, but the empirical confirmation that real flowd serializes `FlowRecord.json` as base64 (not a custom MarshalJSON inline) still needs one live `GET /flows/{id}` (03-VALIDATION Manual-Only / 03-01 carried). A unit test cannot supply a running flowd. Low risk (no custom MarshalJSON found in store.go).

## Self-Check: PASSED

All 12 files present on disk; all 3 task commits (`21161fd`, `6d13f37`, `4cf2081`) in git history. Full suite 202 green (186 baseline + 16 new); flow subtree 87 green; tsc/build/lint clean (0 errors; 5 pre-existing/accepted react-compiler `useReactTable` warnings, matching the established ResultsTable pattern). node_modules not committed.

---
*Phase: 03-flow-console*
*Completed: 2026-06-04*
