---
phase: 04-chat-console
plan: 02
subsystem: ui
tags: [react, chat, tanstack-router, vitest, sonner, copyable-id, sse]

# Dependency graph
requires:
  - phase: 04-chat-console
    provides: "04-01 keystone — useChatStream (sendSync/sessionId/turns/newSession, X-Session-Id capture + body-only reuse, two error channels), turnsReducer (syncReply→one bubble, reset→clear), typed /api/chat client (chatSync + ChatError) + loose zod schemas + chat goldens"
  - phase: 01-foundation
    provides: "CopyableId primitive, sonner toast, shadcn ui (card/textarea/button/label/scroll-area), the /chat placeholder route, dark design tokens"
  - phase: 03-flow-console
    provides: "RunTrigger textarea+disabled+token-styling component pattern mirrored by the Composer"
provides:
  - "ChatPage — the real /chat surface: SessionHeader + scroll-area transcript + Composer, owns useChatStream, wires the SYNC send path (sendSync → one assistant bubble)"
  - "SessionHeader (SESSION + CopyableId when set / muted 'No session yet…' otherwise + direct-fire 'New session')"
  - "MessageBubble (left-aligned Secondary-surface bubble, USER/ASSISTANT mono caption + 2px role rail, children-as-text-nodes)"
  - "Composer (multi-line textarea, Enter-sends/Shift+Enter newline, Send disabled on empty/whitespace, marked 04-03 toggle/Stop seam)"
  - "The real /chat route (ChatPlaceholder removed; router.tsx unchanged)"
  - "ChatPage component tests (sync-into-one-bubble, session display+reuse, New-session reset, 429 send-failure toast, empty state, bare-answer)"
affects: [04-03, chat-streamed-path, chat-step-trace, chat-stop]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Page owns useChatStream + a local controlled composer `draft`/`sending`; Send calls sendSync(draft) and clears sending in a .finally — the hook swallows send-failures into onSendError so sendSync always resolves"
    - "Error-channel split at the UI: onSendError → toast.error('Send failed — {status}: {error}.') + composer re-enables (NOT an in-bubble red error)"
    - "Presentational chat components are prop-driven/stateless (except the Composer's controlled-input ergonomics); all message/answer strings flow as React children → text nodes (no dangerouslySetInnerHTML)"

key-files:
  created:
    - web/src/features/chat/ChatPage.tsx
    - web/src/features/chat/ChatPage.test.tsx
    - web/src/features/chat/components/SessionHeader.tsx
    - web/src/features/chat/components/MessageBubble.tsx
    - web/src/features/chat/components/Composer.tsx
  modified:
    - web/src/app/routes/chat.tsx

key-decisions:
  - "ChatPage tracks its own `sending` flag (set on Send, cleared in sendSync().finally) to disable the composer while the sync request is in flight — the 04-01 hook's `conn` is stream-only and stays idle on the sync path, so a page-local flag is the sync in-flight signal"
  - "The send-failure toast formula reads status+message off the thrown ChatError (instanceof ChatError → `Send failed — {status}: {message}.`); a non-ChatError falls back to `Send failed — {message}.`"
  - "Bare/empty sync answer renders a muted '(no answer returned)' span inside the assistant bubble (Pitfall 5) rather than an empty bubble"
  - "Tests drive the REAL useChatStream + turnsReducer and mock only chatSync (mirrors the 04-01 hook test), so session capture/reuse is asserted via chatSyncMock.mock.calls — a true end-to-end render of the sync slice"

patterns-established:
  - "Pattern: a feature PAGE owns the imperative stream hook + a local controlled composer; child bubble/header/composer components stay presentational"
  - "Pattern: the send-failure channel is a sonner toast + composer re-enable; in-turn agent errors are in-bubble (04-03) — the two never cross"

requirements-completed: [CHAT-02, CHAT-03]

# Metrics
duration: 4min
completed: 2026-06-04
---

# Phase 04 Plan 02: ChatPage sync slice + session header + real /chat route Summary

**The first user-visible chat: an operator opens /chat, types a message, presses Enter, and a synchronous POST /chat reply folds into ONE left-aligned assistant bubble; the server-assigned session_id shows via CopyableId and is reused on the next turn; "New session" clears to the empty state; a 429 send-failure surfaces as the locked toast and re-enables the composer (not an in-bubble red).**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-04T06:53:16Z
- **Completed:** 2026-06-04T06:57:01Z
- **Tasks:** 2 (Task 2 TDD RED→GREEN)
- **Files created:** 5, modified: 1

## Accomplishments
- Replaced the Phase-1 ChatPlaceholder with the real ChatPage on the existing `/chat` route (router.tsx untouched) — the third console nav target is now live.
- Wired the SYNC send path end-to-end onto the 04-01 keystone: Enter/Send → `sendSync` → the reply renders into a single assistant bubble with no step trace (CHAT-03); the user message renders in a USER bubble above it.
- Session continuity (CHAT-02 / D-02): the server `session_id` displays via CopyableId after the first turn and is reused (sent in the request body) on the next turn; "New session" (D-06) clears the transcript to the S6 empty state and resets the id to "No session yet…", with NO confirmation.
- The 429/non-2xx send-failure is the locked toast `Send failed — {status}: {error}.` + the composer re-enables (the error-channel split) — never an in-bubble red error.
- 253 tests green (baseline 247 + 6 new ChatPage tests); full `npm run build`, `tsc -b`, and chat lint all pass.

## Task Commits

Each task was committed atomically (Task 2 followed TDD RED→GREEN):

1. **Task 1: SessionHeader + MessageBubble + Composer (sync Send) components** - `5be0424` (feat)
2. **Task 2: ChatPage sync slice + real /chat route + tests** - `f5864a2` (test RED) → `57ed2d1` (feat GREEN)

**Plan metadata:** committed with this SUMMARY + STATE.md + ROADMAP.md + REQUIREMENTS.md.

_Task 1 is the three presentational components, verified by `tsc -b` per the plan's `<verify>` block (their behaviour is exercised through the Task 2 ChatPage tests, mirroring 04-01's non-behavioural Task-1 pattern). Task 2 is a full RED→GREEN cycle._

## Files Created/Modified
- `web/src/features/chat/ChatPage.tsx` - the /chat surface: SessionHeader + scroll-area transcript (turns→MessageBubble, S6 empty state) + Composer; owns useChatStream; sync Send → sendSync; onSendError→toast; bare-answer→"(no answer returned)"
- `web/src/features/chat/components/SessionHeader.tsx` - SESSION + CopyableId / muted no-session copy + direct-fire "New session"
- `web/src/features/chat/components/MessageBubble.tsx` - left-aligned Secondary-surface bubble, USER/ASSISTANT mono caption + 2px role rail (neutral user / accent assistant), children as text nodes
- `web/src/features/chat/components/Composer.tsx` - multi-line textarea, Enter-sends/Shift+Enter newline, Send disabled on empty/whitespace or disabled; marked 04-03 toggle/Stop seam
- `web/src/features/chat/ChatPage.test.tsx` - 6 tests: empty state, sync-into-one-bubble, session display+reuse, New-session reset, 429 toast + re-enable, bare-answer
- `web/src/app/routes/chat.tsx` - route component now ChatPage; ChatPlaceholder deleted; createRoute/chatRoute export shape unchanged

## Decisions Made
- **Page-local `sending` flag for the sync in-flight signal.** The 04-01 hook's `conn` is stream-only (stays `idle` on the sync path), so ChatPage owns a `sending` flag (set on Send, cleared in `sendSync().finally`) to disable the composer while the sync request is in flight and re-enable it after — including after a send-failure.
- **Toast formula off ChatError.** `instanceof ChatError` → `Send failed — {status}: {message}.`; any other thrown error falls back to `Send failed — {message}.` (locked Phase-1 send-failure copy).
- **Tests mock only `chatSync`, drive the real hook/reducer.** Session capture/reuse is asserted via `chatSyncMock.mock.calls` (turn 1 sends `undefined`, turn 2 sends `sess-sync-1`) — a true end-to-end render of the sync slice, no live backend.
- **Bare answer → muted "(no answer returned)"** (Pitfall 5) rather than a blank bubble.

## Deviations from Plan

None - plan executed exactly as written. No bugs, missing-critical functionality, or blocking issues were encountered; no architectural decisions were needed. The 04-01 keystone (client/reducer/hook) and reused flow/sse files were not modified. No npm dependency was added. Scope held to 04-02's six `files_modified` (the streamed path / StepTrace / Stream|Sync toggle / Stop are left for 04-03 as a marked Composer seam).

## Issues Encountered
None.

## Known Stubs
None that block the plan goal. The Composer leaves an intentional, clearly-commented `SEAM (04-03)` slot in its toolbar where the Stream|Sync toggle + Stop button mount in 04-03 (the streamed path); this is the planned hand-off, not an unwired stub — the sync Send path is fully functional today.

## Verification Results
- `cd web && npx vitest run src/features/chat/ChatPage.test.tsx` → 6 tests passed.
- `cd web && npx vitest run` (full suite) → 31 files, **253 tests passed** (baseline 247 + 6 new; no regression).
- `cd web && npx tsc -b --noEmit` → exit 0.
- `cd web && npm run build` (tsc -b + vite build) → built clean (exit 0).
- `cd web && npx eslint src/features/chat src/app/routes/chat.tsx` → clean (0 problems).
- `cd web && npm run lint` (full) → 0 errors, 6 warnings — all pre-existing TanStack-table `react-hooks/incompatible-library` warnings in flow/memory (out of scope; documented in 04-01).
- Grep gate `dangerouslySetInnerHTML` in `src/features/chat/` → only a doc comment in MessageBubble.tsx, no real call.
- Grep gate auth/scope/session **request** header literal in `src/features/chat/` → none (the only X-Session-Id reference is the 04-01 test asserting the header is `undefined`).
- node_modules not staged/committed (gitignored).

## User Setup Required
None - no external service configuration required. (Chat is auth-none; live verification against a running customer-support + nginx is deferred to the phase gate per 04-VALIDATION Manual-Only rows.)

## Next Phase Readiness
- 04-03 (Slice B) mounts onto this ChatPage: flip the Composer's default Send to the streamed `send`, add the Stream|Sync toggle + Stop in the marked Composer toolbar seam, render the assistant turn's collapsible step trace + ConnectionBadge + the D-05 three-signal distinction (Stopped / in-bubble error / connection-lost). The bubble surface, session header, empty state, and send-failure toast are already in place and tested.
- No blockers. No live backend needed for the test gate.

## Self-Check: PASSED

All 5 created files + the 1 modified file verified present on disk; all 3 task commits (`5be0424`, `f5864a2`, `57ed2d1`) verified in git history.

---
*Phase: 04-chat-console*
*Completed: 2026-06-04*
