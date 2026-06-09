---
phase: 04-chat-console
plan: 03
subsystem: ui
tags: [react, chat, sse, vitest, step-trace, stop, d-05, streaming, toggle]

# Dependency graph
requires:
  - phase: 04-chat-console
    provides: "04-01 keystone — useChatStream (send/sendSync/stop/conn/sessionId/newSession, X-Session-Id capture, Stop→closed-never-errored, two error channels), turnsReducer (step→trace from answer, done→final, error→in-bubble, stop→keeps partial); chat goldens (goldenChatSuccess/Error)"
  - phase: 04-chat-console
    provides: "04-02 Slice A — ChatPage, Composer (multi-line, Enter-sends + a marked 04-03 toggle/Stop seam), MessageBubble, SessionHeader; the real /chat route + sync send path + 429 send-failure toast"
  - phase: 03-flow-console
    provides: "ConnectionBadge (reused verbatim, cross-feature), RawJsonViewer primitive, the TimelineView frame-row PATTERN (mirrored, not reused), the makeFakeSseStream emitter"
  - phase: 01-foundation
    provides: "shadcn collapsible/button/textarea/badge, lucide-react icons, sonner toast, dark design tokens (--status-*)"
provides:
  - "StepTrace — chat-specific collapsible inline step trace: per-kind lucide icon (all neutral slate, unknown→circle) + label + step text (TEXT node) + collapsed RawJsonViewer per frame; expanded + live-tail loader-spin + 'Streaming steps…' while streaming; collapses to clickable '{N} steps' on settle (re-expandable); empty→null"
  - "ChatPage streamed-default Send: mode==='stream' → send() (the DEFAULT); mode==='sync' → sendSync(); both fold into the SAME assistant bubble (D-03/CHAT-03)"
  - "The active assistant turn surface: StepTrace + ConnectionBadge (in-bubble header) + Thinking… placeholder + final answer ('(no answer returned)' if bare) + the D-05 three-signal markers"
  - "Composer Stream|Sync segmented toggle (button group, NO new switch block) + a neutral Stop shown while streaming; textarea/Send/toggle disabled in flight (D-04)"
  - "MessageBubble optional caption-row `aside` slot (hosts the ConnectionBadge)"
  - "The D-05 three-signal distinction proven by tests: muted 'Stopped.' chip (Closed) / red in-bubble 'Failed — {error}.' (Closed) / amber 'Connection lost' badge + dropped line — three visually & semantically distinct treatments"
affects: [phase-4-complete, chat-console]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "StepTrace MIRRORS the Phase-3 frame-row PATTERN (gutter icon + label + collapsed RawJsonViewer + 1px rail + live-tail spin) over chat {kind,text} rows — does NOT reuse the flow-schema-bound TimelineView/FrameRow"
    - "ConnectionBadge/markers attach ONLY to the active (last) assistant turn; earlier turns pass conn='idle' (settled history)"
    - "Send routes by a page-owned `mode`: stream→send (hook drives conn), sync→sendSync (page-local `sending` flag is the in-flight signal); composer disabled = streaming || sending"
    - "StepTrace collapse: streaming always wins (open=true); once settled, an operator override (settledOpen) else the collapsed default — derived during render, no setState-in-effect"

key-files:
  created:
    - web/src/features/chat/components/StepTrace.tsx
    - web/src/features/chat/components/StepTrace.test.tsx
  modified:
    - web/src/features/chat/ChatPage.tsx
    - web/src/features/chat/ChatPage.test.tsx
    - web/src/features/chat/components/Composer.tsx
    - web/src/features/chat/components/MessageBubble.tsx

key-decisions:
  - "StepTrace renders ONLY intermediate step rows; the terminal done(green)/error(red) are NOT step rows — they are handled by the page (the answer / the in-bubble red 'Failed —'). This keeps the trace calm (all-neutral-slate icons) and lets the terminal pop, per UI-SPEC Color table (a)."
  - "Collapse default solved without setState-in-effect (React-Compiler-lint clean): open = streaming ? true : (settledOpen ?? false). Streaming forces expanded; once settled the collapsible follows the operator's override or the collapsed '{N} steps' default."
  - "The ConnectionBadge attaches to the active turn only via a per-turn conn prop (i===lastIndex ? conn : 'idle'); 'idle' renders null, so settled history turns carry no badge."
  - "Sync tooltip 'One-shot reply, no live steps.' implemented as a native `title` attribute on the Sync segment (queryable, no Radix portal) rather than the shadcn tooltip block — simpler + testable, satisfies the UI-SPEC copy contract without a portal."
  - "Stop is a neutral outline Button shown IN PLACE OF Send while streaming (not alongside) — keeps the toolbar single-action and reads benign (D-05: Stop is never destructive-red)."

patterns-established:
  - "Pattern: a chat step trace mirrors the Phase-3 timeline frame-row structure but over the chat envelope — same visual grammar, different schema, no component reuse"
  - "Pattern: the D-05 three not-finished-normally signals render as three distinct in-bubble/header markers keyed off (status, conn); the 04-01 connection machine guarantees Stop→closed so the UI only renders state, never re-derives the closed-vs-errored decision"

requirements-completed: [CHAT-01, CHAT-03]

# Metrics
duration: 6min
completed: 2026-06-04
---

# Phase 4 Plan 03: Streamed default Send + StepTrace + Stop + Stream|Sync toggle + the D-05 three-signal distinction Summary

**The keystone streamed chat: Send now defaults to the streamed `/api/chat/stream` path, each agent `step` frame appends a live collapsible StepTrace row (neutral-slate per-kind icon + answer text + collapsed raw frame) with a Streaming badge + live-tail spin, the trace collapses to "{N} steps" + the final answer on `done`; a Stream|Sync segmented toggle folds the sync one-shot into the SAME bubble; Stop keeps the partial + a muted "Stopped." chip with the connection landing Closed (never errored); an in-stream `error` frame renders in-bubble red "Failed — {error}."; and a transport drop shows the amber "Connection lost" badge + a muted dropped line — three distinct D-05 signals, all proven by component tests against the fake SSE emitter (no live backend).**

## Performance
- **Duration:** 6 min
- **Started:** 2026-06-04T07:01:50Z
- **Completed:** 2026-06-04T07:08:00Z
- **Tasks:** 2 (both TDD RED→GREEN)
- **Files created:** 2, modified: 4

## Accomplishments
- **StepTrace (Task 1)** — the chat-specific collapsible inline step trace, mirroring the Phase-3 frame-row pattern over `{kind,text}` rows: per-kind lucide icon (thought/plan/action/observation/reflection/final, ALL neutral `--status-unknown`; unknown kind → `circle`, never crashes), the step-kind label + the step text as TEXT nodes, a collapsed `RawJsonViewer` per frame, a 1px gutter rail. Expanded + the live-tail icon `loader`-spins + "Streaming steps…" while streaming; collapses to a clickable "{N} steps" summary (re-expandable) once settled; empty steps render nothing. 6 component tests.
- **Streamed-default Send + toggle + Stop + D-05 (Task 2)** — flipped ChatPage's default Send to the streamed `send()` (CHAT-01); added the `Stream | Sync` segmented toggle (a `button` group — NO new `switch` block, per RESEARCH Rec 3) routing `sync` → `sendSync()` into the SAME assistant bubble with no trace (CHAT-03/D-03); the neutral Stop button (shown in place of Send while streaming) wired to the hook's `stop()` (D-04); textarea/Send/toggle disabled in flight.
- **The active assistant turn surface** renders StepTrace + a `ConnectionBadge` (reused verbatim, cross-feature) in the bubble header + the Thinking… placeholder (streaming, zero steps) + the final answer ("(no answer returned)" if bare, Pitfall 5).
- **The D-05 three-signal distinction** (the operator-critical contract): muted "Stopped." chip + Closed badge (operator, benign); red in-bubble "Failed — {error}." (mono) + Closed badge (agent result, no retry); amber "Connection lost" badge + a muted "Connection dropped before the reply finished." line (transport drop). Three colors (slate/red/amber), three locations — proven distinct by tests.
- **264 tests green** (baseline 253 + 11 new ChatPage stream/Stop/error/drop/toggle tests; StepTrace's 6 are within that delta); full `npm run build` (tsc -b + vite build), `tsc -b`, and full `npm run lint` (0 errors) all pass. No npm dependency added.

## Task Commits
Each task followed TDD RED→GREEN, committed atomically:
1. **Task 1: StepTrace component** — `8e7a6f4` (test RED) → `9968cc0` (feat GREEN)
2. **Task 2: streamed Send + toggle + Stop + D-05 wiring** — `df8da66` (test RED) → `ef4055e` (feat GREEN)

_Plan metadata (this SUMMARY + STATE.md + ROADMAP.md + REQUIREMENTS.md) committed separately._

## Files Created/Modified
- `web/src/features/chat/components/StepTrace.tsx` (created) — the collapsible live step trace (per-kind neutral-slate icon + label + text + collapsed RawJsonViewer; live-tail spin; collapse-on-settle "{N} steps")
- `web/src/features/chat/components/StepTrace.test.tsx` (created) — 6 tests: streaming-expanded + live-tail spin, collapse-on-done + re-expand, unknown-kind fallback, empty→null
- `web/src/features/chat/ChatPage.tsx` (modified) — streamed-default Send + mode routing + Stop; the active-turn surface (StepTrace + ConnectionBadge + Thinking…/answer/Failed/Stopped/Connection-lost markers)
- `web/src/features/chat/ChatPage.test.tsx` (modified) — extended to 11 tests: streamed-default + live rows + collapse-on-done, Thinking…, Stop (D-05), in-stream error (D-01), transport drop (D-05), Stream|Sync toggle + session reuse; kept the 04-02 sync/new-session/429/bare-answer
- `web/src/features/chat/components/Composer.tsx` (modified) — the Stream|Sync segmented toggle (native-title Sync tooltip) + the neutral Stop (in place of Send while streaming); toggle disabled in flight
- `web/src/features/chat/components/MessageBubble.tsx` (modified) — optional caption-row `aside` slot (hosts the ConnectionBadge)

## Decisions Made
- **Terminal events are NOT step rows.** StepTrace renders only intermediate steps (all neutral slate); the green-`done` answer + the red-`error` "Failed —" are the page's terminal treatments (UI-SPEC Color table (a)). This keeps the trace calm and lets the terminal pop.
- **Collapse without setState-in-effect.** `open = streaming ? true : (settledOpen ?? false)` — streaming forces expanded, once settled the collapsible follows the operator override or the collapsed "{N} steps" default. Avoids the `react-hooks/set-state-in-effect` lint that the React Compiler rules flag.
- **Per-turn `conn` prop, badge on the active turn only.** Earlier (settled) turns pass `conn='idle'` → `ConnectionBadge` renders null, so only the active turn carries the transport signal.
- **Native `title` for the Sync tooltip.** Simpler + queryable than the Radix tooltip portal; satisfies the locked "One-shot reply, no live steps." copy.
- **Stop replaces Send (not alongside).** A single-action toolbar reads cleaner; Stop is a neutral outline button — never destructive-red (D-05: a Stop is benign).

## Deviations from Plan
None of Rules 1–4 triggered. Two micro-corrections were made to the new test file during the GREEN step (no scope/behavior change):
- **`mockClear` type cast.** The fake emitter's `openSseStream` mock type doesn't declare `mockClear`; the per-test reset uses `vi.mocked(fake.openSseStream).mockClear()` (the fake is module-level via the hoisted factory, so its call count must be cleared between tests for the `toHaveBeenCalledTimes(1)` stream assertion).
- **Badge label copy.** The reused Phase-3 `ConnectionBadge` renders the amber label as "Connection lost" (no trailing period); the test asserts that exact string (the muted dropped-line "Connection dropped before the reply finished." carries the sentence). The UI-SPEC's "Connection lost." with a period referred to the row treatment generally; the actual reused-verbatim badge text is the authority and was not modified.

These are test-authoring details, not plan deviations — the plan's `files_modified` scope held exactly (the 4 modified + StepTrace.tsx/.test.tsx). The 04-01 keystone (hook/reducer/api/golden) and the reused Phase-3 `ConnectionBadge`/`RawJsonViewer`/`lib/sse` were consumed unchanged.

## Issues Encountered
- **`react-hooks/set-state-in-effect` lint** on the first StepTrace draft (a `useEffect`→`setOpen(streaming)` to follow the streaming state). Resolved by deriving `open` during render (`streaming ? true : (settledOpen ?? false)`) with a settled-only operator override — no effect, lint clean.
- **Unused `ArrowDownLeft` import** (a candidate `observation` icon) flagged by tsc — removed (the map uses `eye`).

## Known Stubs
None. The streamed path, toggle, Stop, and all three D-05 markers are fully wired and tested. The only deferred item is live-backend verification (a phase gate, below) — not a stub.

## Threat Flags
None. No new network endpoints, auth paths, or trust boundaries were introduced — the streamed path consumes the existing `chatStream`/`openSseStream` (04-01/Phase-3) unchanged. The threat-model mitigations were honored: every step text / answer / error renders as a React TEXT node (T-04-07), the unknown step `kind` falls back to a neutral `circle` (T-04-08), and the Stop→closed-never-errored contract (T-04-09) is the 04-01 connection machine's guarantee, rendered as three distinct markers.

## Verification Results
- `cd web && npx vitest run src/features/chat/components/StepTrace.test.tsx` → 6 passed.
- `cd web && npx vitest run src/features/chat/ChatPage.test.tsx` → 11 passed.
- `cd web && npx vitest run` (full suite) → **32 files, 264 tests passed** (baseline 253 + 11; no regression).
- `cd web && npx tsc -b --noEmit` → exit 0.
- `cd web && npm run build` (tsc -b + vite build) → built clean (exit 0).
- `cd web && npm run lint` (full) → **0 errors, 6 warnings** — all pre-existing TanStack-table `react-hooks/incompatible-library` warnings in flow/memory (out of scope; documented in 04-01/04-02).
- Grep gate `dangerouslySetInnerHTML` in `src/features/chat/` → only doc comments, no real call (all strings are TEXT nodes).
- Grep gate `shadcn add switch | components/ui/switch` in `src/features/chat/` → NONE (the toggle uses the installed `button`, no new block).
- node_modules not staged/committed (gitignored).

**The three D-05 signals (proven distinct by tests):**
- **Stop** (`sess-stop-1` test) → partial steps STAY, a muted **"Stopped."** chip shows, the badge reads **"Closed"** (NOT "Connection lost"), composer re-enables.
- **In-stream `error` frame** (`sess-err-1`) → in-bubble red **"Failed — tool call failed."**, the partial step kept, badge **"Closed"**, no retry affordance.
- **Transport drop** (`sess-drop-1`, `fail()` with no terminal) → amber **"Connection lost"** badge + muted **"Connection dropped before the reply finished."**, partial trace stays, NOT a red turn error.

**Streamed-default + toggle (proven):**
- Default Send streams (`openSseStream` called, `chatSync` not) → live StepTrace rows + "Streaming" badge → on `done`: final answer + collapsed "2 steps".
- Stream|Sync toggle → "Sync" routes Send to `chatSync` → reply in the SAME bubble, NO trace; session id reused on the next sync turn.

## Manual / Phase-Gate (deferred — VALIDATION Manual-Only)
With the stack up (customer-support + the BFF + nginx), send a streamed message and confirm steps render INCREMENTALLY (per-event flush, not batched) and the session id persists across turns. Deferred to the phase gate — no live backend in the test harness (the fake emitter proves the wiring).

## Next Phase Readiness
Phase 4 (Chat Console) is COMPLETE: 04-01 keystone + 04-02 sync slice + 04-03 streamed slice. The /chat surface delivers CHAT-01 (streamed steps + streaming indicator + stop-on-error), CHAT-02 (session capture/display/reuse + New session), and CHAT-03 (the Stream|Sync toggle into one bubble), plus the operator-critical D-05 three-signal distinction. No blockers; live verification is a phase gate, not a code gap.

## Self-Check: PASSED
All 2 created files + 4 modified files verified present on disk; all 4 task commits (`8e7a6f4`, `9968cc0`, `df8da66`, `ef4055e`) verified in git history.

---
*Phase: 04-chat-console*
*Completed: 2026-06-04*
