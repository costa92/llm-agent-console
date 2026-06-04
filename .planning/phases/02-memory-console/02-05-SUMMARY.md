---
phase: 02-memory-console
plan: 05
subsystem: memory
tags: [react19, tanstack-query, lifecycle, occ, reflect-from-response, splice, pessimistic, confirm-dialogs, dropdown-menu, vitest]

# Dependency graph
requires:
  - phase: 02-01
    provides: "client.pin/unpin/disable/enable/del ({flag,version} / {deleted,version} echoes; body-bearing DELETE Content-Type; all thread expected_version) + parseGatewayError (memory_conflict) + memoryKeys + pin/disable/delete/conflict409 mock fixtures"
  - phase: 02-04
    provides: "useMemoryMutations.ts (handle409Conflict shared 409 OCC-recovery helper + asGatewayError + reportLifecycleError-style conventions) + partialKeys/useItemPartial + the marked extension region"
  - phase: 02-03
    provides: "ItemDrawer action-region host (DrawerActionRegion) + the StateBadges + the ?item search-param setter (delete clears ?item → drawer closes)"
  - phase: 02-02
    provides: "ResultsTable row-action-menu trigger placeholder (D-06) to fill"
  - phase: 01
    provides: "shadcn dialog + dropdown-menu + button (destructive variant) + sonner toast (SHELL-06) + FiveStateWrapper"
provides:
  - "useMemoryMutations: usePin/useUnpin/useDisable/useEnable/useDelete — pin/unpin/disable/enable REFLECT-FROM-RESPONSE the echoed {flag,version} onto the cached item (setQueryData) + matching recall hit (setQueriesData) with NO GET refetch + NO re-run recall (D-09); delete SPLICES the hit out of cached recall + drops the item cache (D-09); all thread expected_version (IC-4 OCC) + the response version replaces the cached one; all reuse handle409Conflict (IC-5)"
  - "LifecycleActions component: state-aware pin/unpin/disable/enable/delete in row (dropdown-menu quick-actions, D-06) + drawer (button-set) variants; two confirm weights (red destructive delete / neutral disable / no-confirm pin·unpin·enable, D-10); pessimistic in-flight via isPending (control disables + spinner + row dim 0.6, D-11); delete onDeleted closes the drawer"
affects: [phase-02-complete]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reflect-from-response (D-09 hybrid): lifecycle flag endpoints echo the authoritative {flag,version}, so — UNLIKE write/patch which refetch GET item — pin/unpin/disable/enable merge the echo directly onto cache via setQueryData (item) + setQueriesData over ['recall'] (hit). No GET round-trip, no re-run recall. delete is setQueriesData filter-out + removeQueries(item)."
    - "Pessimistic delete ordering (D-11): the destructive confirm's onClick only FIRES the mutation; the row is spliced by the hook's onSuccess after the 200, and onDeleted (drawer-close) is passed as the per-call mutate({onSuccess}) so it runs only on real success — a 409 leaves the row in place (amber recovery instead)."
    - "Two confirm weights share ONE component: LifecycleActions renders the Phase-1 RED shadcn dialog (Button variant=destructive, 'cannot be undone', autoFocus Cancel) for delete and a NEUTRAL shadcn dialog (default Button, reversible copy, no red) for disable; pin/unpin/enable bypass both. The same controls render as dropdown-menu items (variant='row') or buttons (variant='drawer')."
    - "Radix DropdownMenu in jsdom: opens via fireEvent.keyDown(trigger,{key:'Enter'}) (pointer-capture path is unavailable) + a hasPointerCapture/scrollIntoView shim; DropdownMenuItem onSelect fires on fireEvent.click. This is the row quick-actions test path."

key-files:
  created:
    - web/src/features/memory/components/LifecycleActions.tsx
    - web/src/features/memory/components/LifecycleActions.test.tsx
    - web/src/features/memory/hooks/useLifecycleMutations.test.ts
  modified:
    - web/src/features/memory/hooks/useMemoryMutations.ts
    - web/src/features/memory/components/ItemDrawer.tsx
    - web/src/features/memory/components/ResultsTable.tsx

key-decisions:
  - "There is NO standalone Phase-1 'destructive dialog' component to reuse — the Phase-1 pattern IS the shadcn dialog + Button variant='destructive'. LifecycleActions builds the delete confirm from that pattern directly (title 'Delete memory item?', body 'cannot be undone', red Delete confirm repeating the verb, autoFocus Cancel) rather than inventing a bespoke component, honoring D-10/RESEARCH 'Don't Hand-Roll'."
  - "pin/unpin/disable/enable REFLECT-FROM-RESPONSE (setQueryData/setQueriesData, no GET refetch) — deliberately DIFFERENT from 02-04's write/patch refetch-after, because these endpoints echo the authoritative flag+version (D-09 hybrid). The 02-04 refetch-fail → partial-banner treatment therefore does NOT apply on their success path; it only applies inside the shared handle409Conflict GET-item refetch (reused verbatim from 02-04), which keeps its own non-fatal-refresh handling."
  - "delete passes onDeleted via the per-call mutate(vars, {onSuccess}) (not the hook's own onSuccess) so the drawer-close (clear ?item) is wired by the CALLER (ItemDrawer) and the row-variant caller simply omits it — the hook's splice removes the row in both cases. Pessimistic: confirm-click fires the mutation; the cache change + drawer close happen only after the 200."
  - "Row quick-actions reuse LifecycleActions(variant='row'): the 02-02 placeholder dropdown trigger is replaced wholesale, and ResultsTable drops its now-unused DropdownMenu/MoreHorizontal imports (LifecycleActions owns the menu + its own row-click stopPropagation + pending dim)."

requirements-completed: [MEM-05, MEM-06, MEM-07]

# Metrics
duration: ~14min
completed: 2026-06-03
---

# Phase 2 Plan 05: Lifecycle — pin/unpin/disable/enable/delete with two confirm weights, pessimistic UI, reflect-from-response + delete splice, 409 reuse (Slice C-2) Summary

**Slice C-2 completes the Memory lifecycle: `useMemoryMutations` gains `usePin/useUnpin/useDisable/useEnable/useDelete`, where the four flag toggles REFLECT-FROM-RESPONSE the gateway's echoed `{flag,version}` straight onto the cached item (`setQueryData`) AND the matching recall hit (`setQueriesData` over `['recall']`) with NO GET refetch and NO re-run recall (D-09 hybrid), `delete` SPLICES its row out of the cached recall data + drops the item cache (D-09), every call threads `expected_version` so the response's new version replaces the cached one (IC-4 OCC), and every `409 memory_conflict` reuses the shared `handle409Conflict` amber recovery from 02-04 (IC-5). The new `LifecycleActions` component renders state-aware pin/unpin/disable/enable/delete in two variants — a row dropdown-menu (D-06 quick-actions) and a drawer button-set — gated by the two confirm weights (D-10): delete behind the Phase-1 RED destructive dialog (repeats "Delete", "This cannot be undone.", Cancel default-focused; pessimistic remove-after-200 that also closes the drawer), disable behind a NEUTRAL light confirm ("Disable this item?", reversible copy, no red), and pin/unpin/enable with no confirm at all. In-flight is pessimistic (D-11/IC-4): the acted control disables + spins and the row/action dims to 0.6 opacity, and state flips ONLY after the backend confirms — a 409 leaves the row in place. Wired into BOTH the ResultsTable row menu and the ItemDrawer action region. This is the final plan of Phase 2; the phase goal (search, inspect, run the full lifecycle with confirm-then-reflect safety) is met.**

## Performance

- **Duration:** ~14 min
- **Tasks:** 2 of 2 (both TDD)
- **Files:** 3 created (1 source + 2 test suites), 3 modified — all under `web/`; node_modules NOT committed

## Accomplishments

- **`useMemoryMutations.ts` (extended)** — five lifecycle mutations added in the 02-04 extension region, reusing `apiFetch`/`queryClient`/`handle409Conflict`/`asGatewayError` verbatim:
  - `usePinMutation`/`useUnpinMutation`/`useDisableMutation`/`useEnableMutation` → `reflectFlag(queryClient, memory_id, {flag, version})` merges the echo onto the item cache + the matching recall hit IN PLACE; toasts `Pinned.`/`Unpinned.`/`Disabled.`/`Enabled.`; NO refetch, NO re-recall.
  - `useDeleteMutation` → `spliceDeleted(queryClient, memory_id)` filters the hit out of every cached recall query + `removeQueries` the item cache + its partial marker; toast `Deleted.`; NO re-recall.
  - All five thread `expected_version` (the cached version passed by the caller) and replace it with the response version on success. `onError` runs `handle409Conflict` first (amber recovery + auto-refetch GET item) and falls through to the generic SHELL-06 red `reportError` only on a non-409 failure. A header comment documents the terminalStateShortCircuit idempotency + the reflect-vs-refetch distinction.
- **`LifecycleActions.tsx` (new)** — props `{item:{memory_id,version,pinned,disabled}, variant:'row'|'drawer', onDeleted?}`. State-aware: a Pin/Unpin toggle (on `item.pinned`), a Disable/Enable toggle (on `item.disabled`), a Delete control. `variant='drawer'` → a `PendingButton` set (each driven by its mutation's `isPending` for the spinner + 0.6 dim); `variant='row'` → a `dropdown-menu` whose trigger swaps to a spinner + dims while any mutation is pending (D-06). Two confirm dialogs: a RED `Dialog` (`Button variant="destructive"` Delete, "cannot be undone", autoFocus Cancel) and a NEUTRAL `Dialog` (default Button Disable, reversible copy). pin/unpin/enable fire directly. Delete's `mutate(vars,{onSuccess:onDeleted})` is the pessimistic close-after-200 hook.
- **`ItemDrawer.tsx` (modified)** — the 02-04 placeholder local lifecycle stub became `DrawerActionRegion`: it keeps the live Patch editor button (02-04) and now renders `<LifecycleActions item={item} variant="drawer" onDeleted={() => setItem(undefined)} />` so a successful delete clears `?item` and closes the drawer (D-05).
- **`ResultsTable.tsx` (modified)** — the 02-02 disabled placeholder dropdown in the `actions` column is replaced by `<LifecycleActions item={hit} variant="row" />` (D-06 quick-actions, expected_version threaded from the hit); the now-unused `DropdownMenu`/`Button`/`MoreHorizontal` imports were removed (LifecycleActions owns them).

## Task Commits

1. **Task 1: lifecycle mutations — flag reflect-from-response + delete splice + expected_version + 409 reuse** — `65f5642` (feat, TDD: 8 behavior cases)
2. **Task 2: LifecycleActions — two confirm weights + pessimistic; wire row menu (D-06) + drawer** — `647b535` (feat, TDD: 7 behavior cases)

_TDD note: per the established Phase-1/02-0x convention, each task's RED and GREEN landed in one atomic feat commit driven by the behavior tests._

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Radix DropdownMenu does not open under fireEvent.click in jsdom**
- **Found during:** Task 2 (the D-06 row quick-actions test)
- **Issue:** Radix's DropdownMenu trigger relies on Pointer Events + `hasPointerCapture`/`scrollIntoView`, none of which jsdom implements, so `fireEvent.click` (and even a synthesized `pointerDown`) never opened the menu — the `menuitem` queries timed out.
- **Fix:** added an `installRadixJsdomShims()` helper (no-op `hasPointerCapture`/`setPointerCapture`/`releasePointerCapture`/`scrollIntoView`) in `beforeEach` and drive the trigger with `fireEvent.keyDown(trigger,{key:'Enter'})` (the keyboard-activation path, which works in jsdom). `DropdownMenuItem onSelect` fires on `fireEvent.click`. No package installed (threat model T-02C2-SC). This is test-harness-only; production behavior is unchanged.
- **Files modified:** web/src/features/memory/components/LifecycleActions.test.tsx
- **Committed in:** `647b535`

**2. [grep-vs-wording] The 409-reuse test's "no generic red toast" assertion initially matched the legitimate amber 409 toast**
- **Found during:** Task 1 (the 409-reuse behavior case)
- **Issue:** `handle409Conflict` fires `"Pin failed — 409: the item changed. Refreshing…"` (the correct amber recovery), but my first `redFired` regex `/Pin failed — \d/` matched it, asserting a false positive.
- **Fix:** tightened the assertion to `genericRedFired = /Pin failed — \d/ && !text.includes('the item changed')` so it distinguishes the amber 409 recovery from a generic non-409 red failure. Behavior-neutral test fix.
- **Files modified:** web/src/features/memory/hooks/useLifecycleMutations.test.ts
- **Committed in:** `65f5642`

**3. [Rule 3 - Blocking] Build `tsc -b` (noUnusedParameters) flagged unused test-callback params**
- **Found during:** Task 2 (the `npm run build` phase gate; `npx tsc --noEmit` did not flag these but `tsc -b` does)
- **Issue:** the `calledWith` predicate's unused `url` param and the stubbed-fetch `input` param tripped `noUnusedParameters` under the build's project-references tsconfig.
- **Fix:** prefixed the unused params (`_u`, `_input`). No behavior change.
- **Files modified:** web/src/features/memory/components/LifecycleActions.test.tsx
- **Committed in:** `647b535`

## Threat Surface Scan

No new security-relevant surface beyond the plan's `<threat_model>`. The BLOCKING/mitigate dispositions are present and test-verified:
- **T-02C2-01 (Tampering / lost-update OCC, mitigate BLOCKING):** every pin/unpin/disable/enable/delete threads the cached `expected_version` (test-asserted on the pin POST body + delete body); a `409 memory_conflict` reuses `handle409Conflict` (amber toast + auto-refetch GET item) — test-asserted it is NOT the generic red path; the response version replaces the cached one (test-asserted version 7 → 8); no optimistic flip — the cache changes only in onSuccess (D-11).
- **T-02C2-02 (Operator error / destructive, mitigate BLOCKING):** delete is gated behind the RED destructive dialog (title/`cannot be undone`/autoFocus Cancel — grep + test-asserted); disable behind a neutral confirm (no `cannot be undone` — grep + test-asserted); pessimistic reflect-after-200 — the delete row is spliced only after the 200 (test-asserted: confirm-click does not remove the row; a 409 leaves the row in place).
- **T-02C2-03 (Spoofing / confused deputy, mitigate):** all lifecycle calls go through the 02-01 client (`scope:{}` + X-Console-* only; no client-trusted X-Tenant-Id/X-User-Id); identity rides on X-Console-* via the inherited apiFetch.
- **T-02C2-04 (Info disclosure, accept):** the SHELL-06 failure toast carries the real upstream status+message + Copy error (internal operator tool, BFF passthrough).
- **T-02C2-SC (installs, accept):** ZERO new npm packages — shadcn dialog/dropdown-menu + sonner were already installed/audited in Phase 1; the jsdom Radix shim is test-local.

## Known Stubs

None. The full lifecycle is wired end-to-end to the real 02-01 client in BOTH surfaces (row quick-actions + drawer). The 02-04 forward-reference (`useMemoryMutations` extension region / ItemDrawer disabled placeholders) is now fully resolved — the disabled lifecycle placeholders are replaced by the live `LifecycleActions`. Fixtures are test-only.

## Verification Evidence

- `cd web && npx vitest run src/features/memory/hooks/useLifecycleMutations.test.ts` — **8 passed** (pin sends expected_version; pin reflect-from-response merges item+hit with no refetch/no re-recall; disable reflect; delete splice + no re-recall; version replace 7→8; 409 reuse amber+refetch not red; success toasts Pinned./Unpinned./Disabled./Enabled./Deleted.; generic 400 red not amber).
- `cd web && npx vitest run src/features/memory/components/LifecycleActions.test.tsx` — **7 passed** (no-confirm Pin fires directly with expected_version, no dialog; disable neutral confirm with reversible copy + no "cannot be undone"; delete red destructive with "cannot be undone" + Cancel focused + DELETE on confirm; delete pessimistic + onDeleted only after 200 + row spliced; pessimistic in-flight disables the control; D-06 row menu exposes Pin/Disable/Delete and pins without the drawer; 409 amber toast + row NOT removed).
- `cd web && npx vitest run src/features/memory` — **81 passed (9 files)** (full Memory Slice A+B+C1+C2).
- `cd web && npx vitest run` (full suite) — **107 passed (16 files)** (phase gate per VALIDATION.md).
- `cd web && npx tsc --noEmit` — exit 0. `cd web && npm run build` (`tsc -b && vite build`) — exit 0 (`dist/assets/index-*.js 657.12 kB / gzip 197.26 kB`).
- `cd web && npm run lint` — exit 0 (0 errors; 3 pre-existing warnings: button.tsx react-refresh + ResultsTable useReactTable incompatible-library — both from prior plans, none from the new files).
- **Phase-gate greps:** `grep -c 'setQueryData\|setQueriesData' useMemoryMutations.ts`=8 (≥2, D-09 reflect+splice); `grep -c 'Delete memory item' LifecycleActions.tsx`=1 (≥1, D-10 red); `grep -c 'cannot be undone' LifecycleActions.tsx`=2 (≥1, delete only — the disable dialog has none, test-asserted); `grep -c handle409Conflict useMemoryMutations.ts`=14 (≥5); `grep -c expected_version useMemoryMutations.ts`=19 (≥5); `grep -c 'isPending' LifecycleActions.tsx`=11 (≥1); `grep -c variant LifecycleActions.tsx`=21 (≥1); `LifecycleActions` in ItemDrawer.tsx=3 + ResultsTable.tsx=2 (≥1 both). No lifecycle onSuccess invalidates/refetches the recall key (reviewer + grep confirmed: 0 recall invalidate/refetch — no auto re-search, D-09).
- node_modules NOT staged; no file deletions in either commit; `.gitignore` and `.planning/memory-inversion/` left untouched (not staged); working tree clean after the two task commits.
- **Environment note (honest):** verified against mocked fetch (golden-wire 02-01 fixtures: pinResponse/unpinResponse/disableResponse/enableResponse/deleteResponse/conflict409 + a 400 envelope) + jsdom, not a live BFF+gateway round-trip (compose stack not started this session). The reflect/splice/OCC/409 contracts are exercised faithfully via the source-verified fixtures; live e2e carries to manual verification per 02-VALIDATION.

## Phase 2 Completion

This is the FINAL plan of Phase 2 (Memory Console). With Slice C-2 landed, the phase goal is met: an operator can **search** recall (Slice A), **inspect** an item in the drawer (Slice B), and **run the full lifecycle** — write/patch (Slice C-1) + pin/unpin/disable/enable/delete (Slice C-2) — with confirm-then-reflect safety (two confirm weights, pessimistic reflect-after-confirm, first-class 409 OCC recovery, no auto re-search). All 5 Memory requirements (MEM-01..MEM-08 across the slices; MEM-05/06/07 here) are satisfied.

## Self-Check: PASSED

- All 3 created files + 3 modified files exist on disk.
- Both task commits present in history: `65f5642` (Task 1), `647b535` (Task 2).

---
*Phase: 02-memory-console*
*Completed: 2026-06-03*
