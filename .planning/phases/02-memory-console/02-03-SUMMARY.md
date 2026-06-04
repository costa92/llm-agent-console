---
phase: 02-memory-console
plan: 03
subsystem: memory
tags: [react19, tanstack-router, shadcn-sheet, drawer, url-synced, five-state, vitest]

# Dependency graph
requires:
  - phase: 02-01
    provides: "useItemQuery(id) (GET /api/memory/items/{id}) + memoryItemSchema/MemoryItem + NormalizedGatewayError + itemFixture/installMemoryFetchMock"
  - phase: 02-02
    provides: "useMemorySearchParams item getter/setter (?item URL param) + StateBadges (PinnedBadge/DisabledBadge) + MemoryPage MemoryConsole host (writes ?item on row click)"
  - phase: 01-05
    provides: "FiveStateWrapper (loading/error states) + RawJsonViewer (collapsed, copy) + CopyableId"
provides:
  - "ItemDrawer: shadcn-sheet drawer whose open state IS the ?item URL param (D-04/D-05) — reload reopens, browser-back closes, link shareable; close clears ?item"
  - "Drawer detail: useItemQuery GET item → FiveStateWrapper(loading→ready; 404 not_found → error INSIDE the drawer, no empty state per IC-2)"
  - "Rendered fields: memory_id via CopyableId + pinned/disabled StateBadges, kind/version/source/category/importance/tags grid, content+tags as TEXT nodes, Separator + Phase-1 RawJsonViewer (collapsed)"
  - "Action-region host: Patch + pin/disable/delete as disabled PLACEHOLDERS (the seam plans 02-04/02-05 fill — no mutations built here)"
affects: [phase-02-04-editor, phase-02-05-lifecycle]

# Tech tracking
tech-stack:
  added:
    - "shadcn sheet block (official registry, radix-ui Dialog-based side-sheet — D-04 drawer-not-route; copy-in, no runtime npm dep)"
  patterns:
    - "URL-as-open-state: the Sheet `open` is `Boolean(item)` from useMemorySearchParams; onOpenChange(false) → setItem(undefined). The URL is the single source of truth (D-05), so reload reopens and browser-back closes without any local open state"
    - "ItemDrawerBody is a separate child of SheetContent mounted only when `item` is set — useItemQuery (which fires the GET) is never mounted while the drawer is closed (mirrors the 02-02 gate-first discipline)"
    - "404-is-error, not-empty (IC-2): the drawer has NO empty state — an id implies existence, so a 404 not_found maps to the FiveStateWrapper error state ('{status} from memory-gateway — {message}') inside the drawer"
    - "Untrusted memory content (content/tags) + the full record (RawJsonViewer) render as React text / JSON.stringify-into-<pre> text nodes — never the raw-HTML escape hatch (stored-XSS T-02B-01)"
    - "Action-region host shipped as disabled placeholders with title hints naming the resolving plan (02-04 Patch / 02-05 lifecycle) so 04/05 wire in without restructuring"

key-files:
  created:
    - web/src/features/memory/components/ItemDrawer.tsx
    - web/src/features/memory/components/ItemDrawer.test.tsx
    - web/src/components/ui/sheet.tsx
  modified:
    - web/src/features/memory/MemoryPage.tsx

key-decisions:
  - "shadcn `sheet` (NOT vaul `drawer`) added per UI-SPEC Registry Safety / RESEARCH A1 — the Radix-Dialog side-sheet is the desktop drawer; official registry, no vetting gate. The generated block matches the project's `radix-ui` umbrella-import convention (same as dialog.tsx); button.tsx was left untouched"
  - "Default sheet width (sm:max-w-sm) overridden to fixed 480px via className (w-[480px] sm:max-w-[480px]) per UI-SPEC Spacing (desktop side-sheet 480px)"
  - "RED+GREEN landed in one atomic feat commit (established 01-03..02-02 convention); the 7-case test was authored first and run against the implementation"
  - "One acceptance grep (dangerouslySetInnerHTML must be 0) matched the XSS-mitigation doc COMMENT, not code; reworded to 'raw-HTML escape hatch' (behavior-neutral) so the literal-token grep returns 0 — same precedent as 02-01/02-02"

requirements-completed: [MEM-02]

# Metrics
duration: ~10min
completed: 2026-06-03
---

# Phase 2 Plan 03: Item detail drawer — ?item-synced sheet + GET item + rendered fields + RawJsonViewer (Slice B) Summary

**Slice B completes the deep-link loop opened by Slice A: when `?item={id}` is set in the URL, `ItemDrawer` slides a fixed-480px shadcn `sheet` over the (still-visible) results list, drives `useItemQuery(item)` to `GET /api/memory/items/{id}`, and renders the item's fields — `memory_id` via the Phase-1 `CopyableId`, pinned/disabled `StateBadges`, a kind/version/source/category/importance grid, and `content`/`tags` as text nodes — plus the Phase-1 `RawJsonViewer` (collapsed) over the full record; the drawer's open state IS the URL param (reload reopens, browser-back closes, link shareable), closing clears `?item` without re-running recall, and a `404 not_found` renders the ERROR state inside the drawer (no empty state, IC-2). An action-region host (Patch + pin/disable/delete) ships as disabled placeholders — the seam plans 02-04/02-05 fill.**

## Performance

- **Duration:** ~10 min
- **Tasks:** 1 of 1 (TDD)
- **Files:** 3 created (ItemDrawer + test + shadcn sheet block), 1 modified (MemoryPage wiring) under `web/`; node_modules NOT committed

## Accomplishments

- **`ItemDrawer.tsx`** — a shadcn `Sheet` whose `open` is `Boolean(item)` read from `useMemorySearchParams().item`; `onOpenChange(false)` calls `setItem(undefined)` so closing (X button or browser-back) clears `?item`. The URL is the single source of truth (D-05) — there is no local open state, so a reload of `/memory?item=mem_123` reopens the drawer and the link is shareable. `SheetContent` is a fixed 480px right side-sheet (`w-[480px] sm:max-w-[480px]`, md padding) overriding the block's default `sm:max-w-sm`.
- **Detail body (`ItemDrawerBody`/`ItemDetail`)** — mounted only when `item` is set, so `useItemQuery` (which fires the GET) never mounts while the drawer is closed. The body is wrapped in `FiveStateWrapper`: `isLoading`→loading spinner; error→error (mapped to `{httpStatus} from memory-gateway — {message}` with the Phase-1 raw-error disclosure + Retry); else ready→the rendered detail. **A 404 `not_found` lands as the error state per IC-2 — the drawer has NO empty state because an id implies existence.**
- **Rendered fields** — header: `<CopyableId id={item.memory_id} />` (mono) + `PinnedBadge`/`DisabledBadge` (reused from 02-02) shown only when set; a two-col field grid of `kind` (Body), `version` (mono), `source`/`category` (muted, conditional), `importance` (mono, conditional); a mono tag-chip row (conditional); and `content` rendered as a `whitespace-pre-wrap` text node. A `Separator`, then `<RawJsonViewer data={item} label="Raw JSON" />` (Phase-1 primitive, collapsed by default, copy-to-clipboard, JSON-into-`<pre>` text). **All gateway strings render as React text / stringified text nodes — never the raw-HTML escape hatch (T-02B-01).**
- **Action-region host (`LifecycleActions`)** — a Patch button + pin/disable/delete buttons rendered **disabled** with `title` hints naming the resolving plan. No mutations are built here; the host is the clearly-marked extension point so plan 02-04 (Patch editor) and 02-05 (pin/unpin/disable/enable/delete + confirms + OCC) wire in without restructuring.
- **`MemoryPage.tsx` wiring** — `<ItemDrawer />` mounted once inside the context-gated `MemoryConsole`, after the results `<section>`, so it overlays the list (D-04 — drawer, not a full route). The D-12 context gate still applies: the drawer subtree only exists once tenant+user are set.

## Task Commits

1. **Task 1: ItemDrawer — ?item-synced sheet, GET item, rendered fields + RawJsonViewer, 404→error** — `9341f2b` (feat, TDD: 7 cases)

_TDD note: per the established Phase-1/Slice-A convention, RED and GREEN landed in one atomic feat commit; the 7-case test drives the implementation._

## Deviations from Plan

### Acceptance-grep wording accommodation (behavior-neutral)

**1. [grep-vs-comment] `dangerouslySetInnerHTML` acceptance grep matched the XSS-mitigation doc comment**
- **Found during:** Task 1 (acceptance-criteria gate)
- **Issue:** `grep -c 'dangerouslySetInnerHTML' ItemDrawer.tsx` must return 0, but returned 1 — from the explanatory comment documenting that content is rendered as a text node and NOT via that escape hatch. The CODE never uses it.
- **Fix:** Reworded the comment to "never the raw-HTML escape hatch" (same meaning, no literal token). No behavior change. Same precedent as 02-01 / 02-02.
- **Files modified:** web/src/features/memory/components/ItemDrawer.tsx
- **Committed in:** `9341f2b`

No Rule 1/2/3 auto-fixes were needed — the 02-01/02-02 substrate (useItemQuery, search-params bridge, primitives, StateBadges) and the official shadcn sheet block composed cleanly.

## Threat Surface Scan

No new security-relevant surface beyond the plan's `<threat_model>`. The BLOCKING/mitigate dispositions are present:
- **T-02B-01 (stored XSS, mitigate BLOCKING):** `grep -c 'dangerouslySetInnerHTML' ItemDrawer.tsx` = 0; `content`/`tags` render as React text children and the full record renders via the Phase-1 `RawJsonViewer` (`JSON.stringify` into a `<pre>` text node). Test asserts the collapsed-by-default raw JSON is absent from the DOM until expanded.
- **T-02B-02 (tampering / SSRF, mitigate):** the drawer drives only `useItemQuery(item)` → the 02-01 client's `getItem` → the allowlisted `GET /api/memory/items/{id}` (X-Console-* via Phase-1 makeApiFetcher); the console never constructs an arbitrary upstream URL.
- **T-02B-03 (info disclosure, accept) / T-02B-SC (sheet block add, accept):** the error state surfaces the real upstream status+message + raw-JSON disclosure (internal operator tool); `sheet` is an official-registry copy-in block (no runtime npm dep).

## Known Stubs

INTENTIONAL forward-references explicitly directed by the plan (each names its resolving plan; none block the Slice-B goal):
- **Action-region host — Patch / pin / disable / delete buttons (ItemDrawer.tsx `LifecycleActions`)** — rendered disabled with `title` hints ("Patch editor arrives in plan 02-04", "Lifecycle actions arrive in plan 02-05"). The Patch editor is 02-04 (D-07/D-08); pin/unpin/disable/enable/delete are 02-05 (D-06/D-10/D-11).

No data-source stubs: the drawer is wired to the real `useItemQuery` (02-01) end-to-end; the rendered fields + RawJsonViewer consume the live GET-item payload. Fixtures (`itemFixture`) are test-only.

## Verification Evidence

- `cd web && npx vitest run src/features/memory/components/ItemDrawer.test.tsx` — **7 passed** (open-on-param→GET, rendered fields incl. CopyableId/kind/version/content/tags, RawJsonViewer collapsed-by-default, loading-not-blank, 404→error-not-empty, close-clears-?item-no-recall, no-item→no-drawer).
- `cd web && npx vitest run src/features/memory` — **50 passed (5 files)** (Slice-A MemoryPage 8 + ResultsTable 9 + Slice-B ItemDrawer 7 + 26 inherited 02-01 api tests).
- `cd web && npx vitest run` (full suite) — **76 passed (12 files)**.
- `cd web && npx tsc --noEmit` — exit 0 (proves the real ItemDrawer import in MemoryPage + the sheet/separator/primitive imports resolve).
- `cd web && npm run lint` — exit 0 (0 errors; 3 warnings: 2 pre-existing shadcn button.tsx fast-refresh + 1 known ResultsTable `useReactTable` react-compiler incompatible-library notice — all from 02-02, none from ItemDrawer).
- `cd web && npm run build` — `dist/assets/index-*.js 642.46 kB / gzip 193.70 kB`, built in 180ms, exit 0.
- **Acceptance greps (ItemDrawer.tsx):** `useItemQuery`=3 (≥1), `RawJsonViewer`=3 (≥1), `CopyableId`=3 (≥1), `Sheet`=14 (≥1), `dangerouslySetInnerHTML`=0, `item:`=2 (≥1, close clears ?item).
- **Wave-3 verification:** Slice-A+B memory tests PASS; `tsc`=0; `dangerouslySetInnerHTML` ItemDrawer=0 (V5); `RawJsonViewer` ItemDrawer≥1; the test asserts 404→error (not empty) and close→?item cleared with no recall call.
- node_modules NOT staged; no file deletions in the commit; `.gitignore`, `.planning/config.json`, and `.planning/memory-inversion/` left untouched (not staged).
- **Environment note (honest):** verified against mocked fetch (golden-wire 02-01 `itemFixture` + a synthesized 404 `not_found` envelope) + jsdom, not a live BFF+gateway round-trip (compose stack not started this session). The GET-item contract is exercised faithfully via the source-verified fixture; live e2e carries to manual verification per 02-VALIDATION.

## Next Plan Readiness

- **02-04 (editor, Slice C):** wires the drawer's disabled "Patch" button + the page-level "New record" button to a shadcn `sheet`-hosted mono JSON editor (write/patch modes); adds the `textarea` block (removed as out-of-scope in 02-02). The `LifecycleActions` host is the seam.
- **02-05 (lifecycle):** fills the drawer's disabled pin/disable/delete buttons (and the ResultsTable row-action menu) using the 02-01 mutation client + `parseGatewayError.conflict` for the 409 OCC-recovery path.

## Self-Check: PASSED

- All 3 created files + 1 modified file exist on disk (ItemDrawer.tsx + ItemDrawer.test.tsx under web/src/features/memory/components/, sheet.tsx under web/src/components/ui/, MemoryPage.tsx modified).
- Task commit present in history: `9341f2b` (Task 1).

---
*Phase: 02-memory-console*
*Completed: 2026-06-03*
