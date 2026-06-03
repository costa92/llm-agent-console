---
phase: 01-foundation
plan: 05
subsystem: ui
tags: [react19, shadcn, sonner, lucide, collapsible, clipboard, five-state, primitives]

# Dependency graph
requires:
  - phase: 01-02
    provides: "web/ SPA scaffold (React 19 + TS 5.9 + Tailwind v4 + 12 shadcn components incl. collapsible/button + Vitest)"
  - phase: 01-04
    provides: "app shell + app-wide sonner Toaster (main.tsx) + index.css --status-*/--muted-foreground tokens + .mono class"
provides:
  - "FiveStateWrapper: loading/empty/error/partial/ready state machine per 01-UI-SPEC five-state contract; error state carries collapsed raw-JSON disclosure; partial banner renders above children; precedence-ordered and designed to EXTEND (Phase 5 SSE states layer on top)"
  - "RawJsonViewer({ data, label? }): collapsible (shadcn Collapsible) mono JSON viewer, collapsed by default, always-visible copy button (writes pretty JSON to clipboard, toasts 'Copied', Copy->Check 1s)"
  - "CopyableId({ id, className? }): mono inline id with hover-reveal copy icon (32px hit target), click copies id + toasts 'Copied' + Copy->Check 1s flip"
affects: [phase-02-memory, phase-03-flow, phase-04-chat, phase-05-health-polling]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Five-state primitive: precedence if-chain (loading > error > empty > ready); partial is a banner ABOVE children, not a replacement — a blank panel is a contract violation"
    - "Exact UI-SPEC copy built via template literals (status/service omitted when undefined) — never a literal '{service}' placeholder"
    - "Clipboard + 1s icon-flip + sonner 'Copied' toast is shared between RawJsonViewer and CopyableId (useState + setTimeout, navigator.clipboard.writeText)"
    - "Icon-only buttons use shadcn Button size='icon' (size-8 = 32px min hit target per UI-SPEC interactive rule)"
    - "Status colors applied via inline style={{ color: 'var(--status-down|degraded|unknown)' }} so the exact UI-SPEC hex tokens (not Tailwind palette) drive state color"

key-files:
  created:
    - web/src/components/primitives/FiveStateWrapper.tsx
    - web/src/components/primitives/RawJsonViewer.tsx
    - web/src/components/primitives/CopyableId.tsx
    - web/src/test/FiveStateWrapper.test.tsx
    - web/src/test/RawJsonViewer.test.tsx
    - web/src/test/CopyableId.test.tsx
  modified: []

key-decisions:
  - "FiveStateWrapper exposes optional onRetry/onSetContext handlers — the Retry and 'Set context' buttons are rendered by the primitive but their behavior is a consumer concern (per plan: do not test Retry click), keeping the primitive reusable across Phases 2-5"
  - "Error-state raw-JSON disclosure is built inline (shadcn Collapsible + <pre>) rather than reusing RawJsonViewer, because Task 1 (FiveStateWrapper) is committed before Task 2 (RawJsonViewer) per the plan's atomic-task ordering; the disclosure honors the same collapsed-by-default contract"
  - "Comment wording in FiveStateWrapper adjusted so 'from {' literal count is 0 (acceptance grep) — the rendered error copy uses 'from ${service}' template literals, the comments describe it without the literal placeholder"

requirements-completed: [SHELL-05, SHELL-06, SHELL-07]

# Metrics
duration: 3min
completed: 2026-06-03
---

# Phase 1 Plan 05: Cross-cutting Primitives Summary

**The three reusable UI primitives every later phase depends on — FiveStateWrapper (the five visually-distinct states: loading / empty / error / partial / ready, where a blank panel is a contract violation), RawJsonViewer (collapsed-by-default mono JSON with copy-to-clipboard + 'Copied' toast), and CopyableId (mono id with hover-reveal copy icon, 32px hit target, Copy->Check flip + 'Copied' toast) — built to 01-UI-SPEC exactly, on the existing shadcn set and app-wide sonner toast, with full unit coverage.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-06-03T07:15:14Z
- **Completed:** 2026-06-03T07:18:16Z
- **Tasks:** 2 of 2
- **Files:** 6 created (3 primitives + 3 test suites) under web/; node_modules NOT committed

## Accomplishments

- **FiveStateWrapper** (`FiveStateProps`: `{ loading, error?, empty?, partial?, children, onRetry?, onSetContext? }`) implements the five-state contract as a precedence if-chain:
  - **loading** → `Loader` (animate-spin, `--status-unknown`) + "Loading…" muted body; children suppressed.
  - **error** → `AlertCircle` (`--status-down`) + exact copy `"{status} from {service} — {message}."` (status/service omitted when undefined, built via template literals), a ghost "Retry" button, and a collapsed-by-default "View raw JSON" disclosure (shadcn Collapsible + mono `<pre>`); children suppressed.
  - **empty** → `Inbox` icon + heading "No operator context set" (16px semibold) + body "Set a tenant id and user id to reach the backends. Project and session are optional." + primary "Set context" button; children suppressed.
  - **partial** → amber `AlertTriangle` (`--status-degraded`) banner "Showing partial data — {message}." rendered ABOVE the children (not replacing them).
  - **ready** → only children.
- **RawJsonViewer** (`{ data, label? }`): shadcn `Collapsible` collapsed by default (`open` initializes `false`), ChevronRight→ChevronDown toggle, mono `<pre>` (`text-xs`, `--muted-foreground` on `--card`) rendering `JSON.stringify(data, null, 2)`. Always-visible icon-only copy button (`size="icon"` = 32px) calls `navigator.clipboard.writeText(pretty)`, `toast.success("Copied")`, and swaps `Copy`→`Check` for 1s. No `dangerouslySetInnerHTML` — JSON is a text node (T-05-01 mitigated). No syntax-highlighting lib in Phase 1 (deferred per RESEARCH.md; no rainbow).
- **CopyableId** (`{ id, className? }`): mono inline `<span>` (14px Body) with a hover-revealed copy icon (`group` + `opacity-0 group-hover:opacity-100`, also revealed on keyboard focus), 32px hit target. Click → `navigator.clipboard.writeText(id)` + `toast.success("Copied")` + `Copy`→`Check` for 1s (icon tints to `--status-up` while copied).
- All three reuse the existing app-wide sonner toast from 01-04 (no second toast system) and the `.mono` class + `--status-*`/`--muted-foreground` tokens from `index.css`. **Zero new npm packages** (T-05-SC).

## Task Commits

1. **Task 1: FiveStateWrapper — five states + UI-SPEC copy/icons** — `7429dbc` (feat, TDD: 6 behavior cases RED then GREEN)
2. **Task 2: RawJsonViewer + CopyableId** — `c8309b3` (feat, TDD: 4 + 3 behavior cases RED then GREEN)

_TDD note: per the 01-03/01-04 convention, each task's RED and GREEN landed in one atomic feat commit. RED was verified separately (import-resolution failure) before implementing._

## Decisions Made

See `key-decisions` frontmatter. Headline: the primitive renders Retry/"Set context" buttons but their handlers are optional consumer-supplied props (kept reusable); the error-state raw-JSON disclosure is built inline rather than importing RawJsonViewer because Task 1 commits before Task 2 (both honor the same collapsed-by-default contract); FiveStateWrapper comment wording was adjusted so the `from {` acceptance grep returns 0 while the rendered copy uses template literals.

## Deviations from Plan

None functionally — plan executed as written. One acceptance-grep accommodation (not a behavior change): the `grep -c 'from {'` criterion requires 0, and my initial code comments documenting the spec copy contained the literal `from {service}`. Rewrote the comments to describe the template-literal interpolation without the literal placeholder; the rendered error copy was always `"{status} from ${service} — ..."` via template literals. No production behavior changed.

## Threat Surface Scan

No new security-relevant surface beyond the plan's `<threat_model>`:
- **T-05-01 (Tampering, mitigate):** RawJsonViewer renders via `JSON.stringify()` into a `<pre>` text node; no `dangerouslySetInnerHTML` anywhere (`grep -c dangerouslySetInnerHTML web/src/components/primitives/*` = 0). Mitigation present per Rule-2 disposition.
- **T-05-02 / T-05-03 (Info Disclosure, accept):** clipboard writes and the error raw-JSON disclosure are gated on explicit user click (no auto-copy, no auto-expand); the "Copied" toast confirms the action.
- **T-05-SC (accept):** no new npm packages — `tech-stack.added: []`; all icons/Collapsible/Button/sonner were vetted in 01-02.

## Known Stubs

None. All three primitives are fully wired (real clipboard API, real sonner toast, real shadcn Collapsible). Syntax colorization of RawJsonViewer is an explicit deferred follow-up (plain mono `<pre>` is the Phase-1 contract per RESEARCH.md), not a stub blocking the plan goal.

## Verification Evidence

- `cd web && npx vitest run` — **26 passed (7 files)**: FiveStateWrapper 6, RawJsonViewer 4, CopyableId 3, plus the 13 inherited (OperatorContext/NavBar/Toast/smoke) — all green.
- `cd web && npx tsc --noEmit` — exit 0.
- `cd web && npm run build` — dist emitted (index.js 465.62 kB / gzip 146.98 kB), exit 0.
- `cd web && npm run lint` — exit 0 (0 errors; 2 pre-existing shadcn warnings on badge.tsx/button.tsx, unchanged since 01-02).
- Acceptance greps — FiveStateWrapper: `Loading`=3 (≥1), `No operator context set`=1, `from {`=0, `Showing partial data`=1. RawJsonViewer: `Collapsible`=10 (≥1), `mono`=2 (≥1), `navigator.clipboard`=1 (≥1). CopyableId: `mono`=2 (≥1), `navigator.clipboard`=1 (≥1), `toast.success`=1 (≥1).
- node_modules NOT staged; no file deletions; `.planning/config.json` left modified-but-unstaged/untouched per constraints; no Go / sibling-repo edits.

## Next Phase Readiness

- **Phase 2 (Memory)** mounts at `/memory` and wraps every list/detail panel in `FiveStateWrapper`, rendering memory item ids via `CopyableId` and memory-item bodies / error payloads via `RawJsonViewer`. The primitive APIs are clean and prop-driven (loading/error/empty/partial booleans + optional handlers) for direct reuse.
- **Phase 5 (Health/SSE)** extends the five-state machine with disconnected/reconnecting states — the precedence if-chain is designed to add cases, not be rewritten.
- **Environment note (honest):** clipboard and toast were verified via mocked `navigator.clipboard` + mocked `sonner` in jsdom (the plan's prescribed test strategy); a live browser clipboard round-trip was not exercised in this headless session. The shadcn Collapsible expand/collapse and the icon-flip timing are verified through DOM assertions.

## Self-Check: PASSED

- All 6 created files exist (3 primitives under web/src/components/primitives/, 3 tests under web/src/test/).
- Both task commits present in history: `7429dbc` (Task 1), `c8309b3` (Task 2).

---
*Phase: 01-foundation*
*Completed: 2026-06-03*
