---
phase: 02-memory-console
plan: 04
subsystem: memory
tags: [react19, tanstack-query, zod, mutations, occ, refetch-after, partial-state, vitest]

# Dependency graph
requires:
  - phase: 02-01
    provides: "client.write/patch/getItem + parseGatewayError (.conflict) + writeRecordSchema/patchFieldsSchema + memoryKeys + installMemoryFetchMock (writeResponse/patchResponse/conflict409 fixtures)"
  - phase: 02-03
    provides: "ItemDrawer (action-region 'Patch' stub + FiveStateWrapper body host) + MemoryPage 'New record' stub"
  - phase: 01-04
    provides: "makeApiFetcher (X-Console-* injection) + reportError SHELL-06 failure-toast helper (OperatorContextBar)"
  - phase: 01-05
    provides: "FiveStateWrapper.partial?:{message} amber alert-triangle banner"
provides:
  - "useMemoryMutations: useWriteMutation + usePatchMutation with D-09 refetch-after (GET item for the lean body; recall row version merged in place, never re-run); pessimistic via isPending (D-11)"
  - "handle409Conflict(err, id, {actionLabel, queryClient, apiFetch}): first-class amber memory_conflict OCC recovery (toast + auto-refetch GET item + re-enable retry) — reused by plan 05 flag/delete mutations"
  - "Per-item PARTIAL marker (queries.ts partialKeys.itemPartial + useItemPartial): a 200 mutation whose refetch-after fails writes {message} so the open drawer renders the amber 'Showing partial data' banner — never silent stale content, never a red error (D-09 cardinal-sin guard)"
  - "EditorDrawer: one sheet-hosted mono JSON editor, two modes (write|patch); JSON.parse→zod validation ladder gating an accent Submit; edits only the record/patch object (console assembles scope/idempotency/expected_version)"
  - "shadcn textarea primitive (copy-in)"
affects: [phase-02-05-lifecycle]

# Tech tracking
tech-stack:
  added:
    - "shadcn textarea block (copy-in primitive, no runtime npm dep) — the editor surface"
  patterns:
    - "Refetch-after-mutation calls GET item DIRECTLY (getItem + setQueryData) rather than fetchQuery/refetchQueries: fetchQuery dedupes against a just-populated drawer cache and refetchQueries needs an active observer; the direct call makes the D-09 partial guard fire deterministically regardless of observer state"
    - "PARTIAL-on-refetch-fail is a per-item marker in the query cache (partialKeys.itemPartial via setQueryData) so the EditorDrawer (which closes on the 200) and the ItemDrawer (which stays open and reads useItemPartial) communicate the degraded-body signal without prop drilling; a successful refresh clears it"
    - "handle409Conflict returns boolean (handled?) so the mutation onError falls through to the generic SHELL-06 red toast only when it is NOT a memory_conflict; the helper is queryClient/apiFetch-injected so plan 05's flag/delete mutations reuse it verbatim"
    - "validation ladder is a pure validate(text, mode) → {ok|message}: JSON.parse rung first ('Invalid JSON — {msg}.'), zod rung second ('{field}: {rule}.'); canSubmit = ok && !isPending so Submit is the single accent action gated by both rungs + the pessimistic in-flight"
    - "recall row version merged via setQueriesData over the ['recall'] key (in place) — NEVER invalidate/refetch recall (D-09: search is operator-initiated)"

key-files:
  created:
    - web/src/features/memory/hooks/useMemoryMutations.ts
    - web/src/features/memory/hooks/useMemoryMutations.test.ts
    - web/src/features/memory/components/EditorDrawer.tsx
    - web/src/features/memory/components/EditorDrawer.test.tsx
    - web/src/components/ui/textarea.tsx
  modified:
    - web/src/features/memory/api/queries.ts
    - web/src/features/memory/MemoryPage.tsx
    - web/src/features/memory/components/ItemDrawer.tsx

key-decisions:
  - "Refetch-after uses a direct getItem()+setQueryData rather than queryClient.fetchQuery/refetchQueries — fetchQuery returns the freshly-populated drawer cache without a network hit (dedup) and refetchQueries is a no-op without an active observer, either of which would silently defeat the D-09 partial-on-refetch-fail guard. The direct call is deterministic and writes the authoritative body into the item cache itself."
  - "PARTIAL state is stored as a per-item cache marker (partialKeys.itemPartial) read by useItemPartial, NOT held in the mutation hook's React state — the EditorDrawer closes on the 200 (the change landed) while the ItemDrawer stays open and must render the amber banner; the cache marker is the shared channel between the two without prop drilling."
  - "@testing-library/user-event is NOT a project dependency and the threat model forbids new installs (T-02C1-SC) — the EditorDrawer test drives the textarea via fireEvent.change (whole-value set, no per-char JSON re-interpretation) and buttons via fireEvent.click, matching the established Slice-A/B test convention. No package was installed."
  - "Reused the Phase-1 reportError (SHELL-06 '{action} failed — {status}: {message}' + Copy error) for the generic red failure toast rather than re-implementing it."

requirements-completed: [MEM-03, MEM-04]

# Metrics
duration: ~12min
completed: 2026-06-03
---

# Phase 2 Plan 04: Write/patch JSON editor (one editor, two modes) + write/patch mutations (refetch-after, D-09) + first-class 409 OCC recovery (Slice C-1) Summary

**Slice C-1 makes the Memory Console writable: one `EditorDrawer` serves both "New record" (write mode, templated `{kind:semantic, content:""}`) and "Patch" (patch mode, pre-filled with the item's patchable fields only) through a single mono-JSON textarea gated by a JSON.parse→zod ladder; the editor edits ONLY the operator's record/patch object while the console assembles `scope:{}` + a fresh idempotency key + `expected_version` (T-02C1-01). `useMemoryMutations` exposes `useWriteMutation`/`usePatchMutation` that thread `expected_version` (OCC), refetch `GET item` after the lean 200 to load the authoritative body (D-09 — never trusting the lean response), merge the recall row version in place WITHOUT re-running recall, and drive a pessimistic in-flight Submit via `isPending` (D-11). A stale-version `409 memory_conflict` is a first-class amber recovery via the shared `handle409Conflict` (toast + auto-refetch + re-enable retry — reused by plan 05), and a 200-mutation-whose-refetch-after-FAILS surfaces the drawer's amber "Showing partial data — couldn't refresh the item body; the change was saved." banner (a per-item cache marker, never silent stale content, never a red error — the D-09 cardinal-sin guard).**

## Performance

- **Duration:** ~12 min
- **Tasks:** 2 of 2 (both TDD)
- **Files:** 5 created (2 source + 1 primitive + 2 test suites), 3 modified — all under `web/`; node_modules NOT committed

## Accomplishments

- **`useMemoryMutations.ts`** — `useWriteMutation` (POST /memory/write; "Record written." toast; exposes the new `memory_id` for offer-open; refetch-after the new item so an offered-open drawer is authoritative) + `usePatchMutation` (PATCH /memory/items/{id}; threads `expected_version`; "Patched." toast; refetch-after GET item + recall-row version merge in place). `handle409Conflict` is the shared first-class amber `memory_conflict` recovery (toast + auto-refetch GET item via the new version + re-enable retry), returns a `handled` boolean so onError falls through to the generic SHELL-06 red toast only on non-409 failures. `refetchItemAfterMutation` calls `getItem` directly and on throw sets the per-item PARTIAL marker; recall is NEVER auto-re-run. A clearly-marked extension region notes plan 05 adds pin/disable/delete here reusing the same helper + conventions.
- **`queries.ts` (modified)** — added `partialKeys.itemPartial(id)` + `useItemPartial(id)`: a cache-backed per-item partial marker (written by the mutations on a refetch-after fail, read reactively by the drawer; cleared on a successful refresh). `enabled:false` + no queryFn — it only ever observes what the mutation hooks `setQueryData`.
- **`EditorDrawer.tsx`** — props `{mode, item?, open, onOpenChange}`; one shadcn `Sheet` + mono `Textarea`. Write mode seeds `WRITE_TEMPLATE` (record object only); patch mode seeds `patchSeed(item)` (content/category/tags/importance only) with the patch-mode note. Pure `validate(text, mode)` runs the JSON.parse→`writeRecordSchema`/`patchFieldsSchema`.safeParse ladder; the accent Submit is `canSubmit = ok && !isPending` (pessimistic, D-11). Write submit → offer-open (`setItem(memory_id)`); patch submit → threads `expected_version: item.version` and closes on success. The editor never exposes envelope fields.
- **`MemoryPage.tsx` / `ItemDrawer.tsx` (modified)** — "New record" now opens `<EditorDrawer mode="write" />` (local open state, keyed for a fresh template each open); ItemDrawer's "Patch" opens `<EditorDrawer mode="patch" item={item} />` (replacing the 02-03 disabled stub, keyed on id+version). ItemDrawer's `FiveStateWrapper` now reads `useItemPartial(id)` into its `partial` prop so a 200-mutation refetch-after fail renders the amber banner over the stale body.
- **`textarea.tsx`** — the shadcn textarea copy-in primitive (no runtime npm dep), the editor surface.

## Task Commits

1. **Task 1: useMemoryMutations — write/patch + refetch-after (D-09) + 409 OCC recovery (IC-5) + partial guard** — `1bb2213` (feat, TDD: 8 behavior cases incl. PATCH-200-but-GET-503 → partial)
2. **Task 2: EditorDrawer — one editor two modes + JSON.parse→zod ladder + pessimistic submit + partial-banner wiring** — `c355d16` (feat, TDD: 8 behavior cases incl. partial-banner-on-refetch-fail)

_TDD note: per the established Phase-1/02-0x convention, each task's RED and GREEN landed in one atomic feat commit; the behavior tests drive the implementation. Task 2's commit also folds the small `useMemoryMutations` refetch refactor (direct-getItem) + comment rewords that the partial-banner component wiring depends on._

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `@testing-library/user-event` is not installed; the threat model forbids new installs**
- **Found during:** Task 2 (the plan's `<action>` says "use userEvent to type into the textarea")
- **Issue:** `@testing-library/user-event` is not a project dependency (`web/package.json`), and threat `T-02C1-SC` (+ the global CLAUDE.md install guard) forbids installing new packages in this phase. The import failed module resolution.
- **Fix:** drive the editor textarea via `fireEvent.change` (whole-value set — no per-character JSON re-interpretation, which is actually MORE reliable for pasting raw JSON) and buttons via `fireEvent.click`, matching the established Slice-A/B test convention. No package installed.
- **Files modified:** web/src/features/memory/components/EditorDrawer.test.tsx
- **Committed in:** `c355d16`

**2. [Rule 1 - Bug] Refetch-after via fetchQuery/refetchQueries silently defeated the D-09 partial guard**
- **Found during:** Task 2 (the partial-banner component test)
- **Issue:** `queryClient.fetchQuery` returns the freshly-populated item cache (a just-opened drawer) WITHOUT a network hit (dedup against fresh data), and `refetchQueries`/`invalidateQueries` is a no-op when no observer is mounted (the write offer-open path) — either of which means the post-200 GET item never fires, so a degraded refetch would NOT trip the partial guard (it would silently show stale content — the exact cardinal sin the guard exists to prevent).
- **Fix:** `refetchItemAfterMutation` now calls `getItem(apiFetch, id)` DIRECTLY, writes the authoritative body into the item cache via `setQueryData` on success, and on throw sets the per-item partial marker. Deterministic regardless of observer/dedup state.
- **Files modified:** web/src/features/memory/hooks/useMemoryMutations.ts
- **Committed in:** `c355d16`

### Acceptance-grep wording accommodation (behavior-neutral)

**3. [grep-vs-comment/code] The `idempotency_key|"scope"|expected_version` grep (must be 0 in the editable template) matched comments + the legitimate OCC-version assembly line**
- **Found during:** Task 2 (acceptance-criteria gate, line 212)
- **Issue:** the grep returned >0, from (a) explanatory comments naming the envelope fields the editor deliberately does NOT expose, and (b) the single code line `expected_version: item.version` — which is the console ASSEMBLING the OCC version around the patch object, exactly as the spec mandates (the operator never edits it). The editable template strings (`WRITE_TEMPLATE`, `patchSeed`) contain ZERO envelope tokens.
- **Fix:** reworded the comments to drop the literal tokens (behavior-neutral, same precedent as 02-01/02-03). The `expected_version: item.version` assembly line legitimately remains — it is covered by the criterion's "Reviewer confirms the textarea template is the record/patch object only" clause, and the EditorDrawer test asserts both that the textarea value has no envelope fields AND that the console assembles `scope`/`idempotency_key`/`expected_version` in the request.
- **Files modified:** web/src/features/memory/components/EditorDrawer.tsx
- **Committed in:** `c355d16`

## Threat Surface Scan

No new security-relevant surface beyond the plan's `<threat_model>`. The BLOCKING/mitigate dispositions are present and test-verified:
- **T-02C1-01 (Spoofing / confused deputy, mitigate BLOCKING):** the editor edits only the record/patch object; the editable templates carry no envelope fields, and the write-submit test asserts the console assembles `scope:{}` + `idempotency_key` + (for patch) `expected_version` — identity rides only on X-Console-* (inherited via the 02-01 client).
- **T-02C1-02 (Input validation V5, mitigate):** the JSON.parse→zod ladder (writeRecordSchema/patchFieldsSchema) gates Submit; the gateway remains authoritative.
- **T-02C1-03 (Tampering / lost update OCC, mitigate BLOCKING):** every patch sends the cached `expected_version`; a 409 is the first-class amber `handle409Conflict` recovery (auto-refetch + retry), never a silent loop, never an optimistic flip (pessimistic, D-11).
- **T-02C1-04 (Repudiation / silent failure, mitigate BLOCKING):** a refetch-after failure on a 200 mutation is caught and surfaced as the amber partial banner (success toast still fires; body marked stale), test-verified incl. "no red 'Patch failed' toast fired". The console never shows stale content as fresh nor masks the saved change behind a red error.
- **T-02C1-05 (Info disclosure, accept) / T-02C1-SC (installs, accept):** the SHELL-06 failure toast carries the real upstream status+message + Copy error; ZERO new npm packages (textarea is a copy-in shadcn primitive, not a dependency).

## Known Stubs

INTENTIONAL forward-references (named to their resolving plan; none block the Slice-C-1 goal):
- **ItemDrawer `LifecycleActions` pin/unpin/disable/enable/delete** remain disabled placeholders with `title` hints — plan 02-05 (D-06/D-10/D-11). The "Patch" action is now LIVE.
- **`useMemoryMutations` extension region** documents that plan 02-05 adds `usePinMutation`/`useDisableMutation`/`useDeleteMutation` reusing `handle409Conflict` + the partial-banner treatment.

No data-source stubs: write/patch are wired end-to-end to the real 02-01 client; the editor and partial banner consume live mutation/refetch state. Fixtures are test-only.

## Verification Evidence

- `cd web && npx vitest run src/features/memory/hooks/useMemoryMutations.test.ts` — **8 passed** (patch threads expected_version; patch refetch-after; no-auto-re-search; write "Record written." + new id; patch "Patched."; PATCH-200-but-GET-503 → partial set + success toast + no red error; 409 first-class amber + auto-refetch; generic 400 SHELL-06 red).
- `cd web && npx vitest run src/features/memory/components/EditorDrawer.test.tsx` — **8 passed** (write template; patch pre-fill patchable-only; parse ladder; write+patch schema ladders; record-only payload; patch expected_version threading; partial banner on refetch-fail with "Patched." toast + no red error).
- `cd web && npx vitest run src/features/memory` — **66 passed (7 files)** (Slice A+B+C1).
- `cd web && npx vitest run` (full suite) — **92 passed (14 files)**.
- `cd web && npx tsc --noEmit` — exit 0.
- `cd web && npm run lint` — exit 0 (0 errors; 3 pre-existing warnings: shadcn button.tsx + ResultsTable useReactTable — all from prior plans, none from the new files).
- `cd web && npm run build` — `dist/assets/index-*.js 650.24 kB / gzip 196.07 kB`, exit 0.
- **Wave-4 verification checks:** memory tests PASS; tsc=0; `grep -c memory_conflict useMemoryMutations.ts`=5 (≥1); `grep -cE 'invalidateQueries|refetchQueries|fetchQuery'`=6 (≥1, item-targeted); `grep -c 'Showing partial data' useMemoryMutations.ts`=2 (≥1); EditorDrawer editable templates have no envelope fields (V4, test-asserted); useMemoryMutations.test asserts recall is NOT invalidated on success; EditorDrawer.test asserts the 200-but-refetch-fail case renders the amber partial banner (not stale content, not a red error).
- **Acceptance greps:** EditorDrawer.tsx — `safeParse|.parse(`=2 (≥1), `JSON.parse`=4 (≥1), `writeRecordSchema`=4 (≥1), `patchFieldsSchema`=3 (≥1), `Invalid JSON`=2 (≥1), `isPending`=6 (≥1); ItemDrawer.tsx — `partial|Showing partial data`=4 (≥1). useMemoryMutations.ts — `Record written|Patched`=3 (≥1), `expected_version`=6 (≥1), recall merge via setQueriesData only (0 recall invalidate/refetch).
- node_modules NOT staged; no file deletions in either commit; `.gitignore`, `.planning/config.json`, and `.planning/memory-inversion/` left untouched (not staged).
- **Environment note (honest):** verified against mocked fetch (golden-wire 02-01 fixtures: writeResponse/patchResponse/conflict409 + a synthesized 503 refetch failure) + jsdom, not a live BFF+gateway round-trip (compose stack not started this session). The write/patch/409/partial contracts are exercised faithfully via the source-verified fixtures; live e2e carries to manual verification per 02-VALIDATION.

## Next Plan Readiness

- **02-05 (lifecycle, Slice C-2):** fills ItemDrawer's disabled pin/unpin/disable/enable/delete (and the row-action menu) using the 02-01 lifecycle client + `usePinMutation`/`useDisableMutation`/`useDeleteMutation` added to `useMemoryMutations.ts` — reusing `handle409Conflict` (first-class 409), the SHELL-06 toast + version-threading conventions, AND the same refetch-fail → per-item partial-banner treatment for any flag-merge refetch path. The extension region + `partialKeys`/`useItemPartial` are the seam.

## Self-Check: PASSED

- All 5 created files + 3 modified files exist on disk.
- Both task commits present in history: `1bb2213` (Task 1), `c355d16` (Task 2).

---
*Phase: 02-memory-console*
*Completed: 2026-06-03*
