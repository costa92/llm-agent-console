---
phase: 04-chat-console
plan: 01
subsystem: api
tags: [react, sse, zod, vitest, chat, reducer, hooks, tdd]

# Dependency graph
requires:
  - phase: 03-flow-console
    provides: "openSseStream (lib/sse.ts) with onOpen header read + abort; connReducer (flow/timeline/connection.ts) terminal-then-error guard; makeFakeSseStream + frames() (test/mocks/fetch-event-source.ts); makeOnOpen X-Run-ID seam (flow/api/stream.ts) mirrored as makeOnSession"
provides:
  - "Typed /api/chat client (chatSync) + loose zod schemas (chatRequest/chatResponse/streamEnvelope/chatError)"
  - "chatStream() over the reused openSseStream + makeOnSession reading X-Session-Id"
  - "Pure turnsReducer (step->trace from answer, done->finalAnswer+collapse, error->in-bubble, stop->keeps partial, syncReply->one bubble, reset->clear)"
  - "Imperative useChatStream hook (send/sendSync/stop/newSession, X-Session-Id capture + body-only reuse, Stop->closed never errored, two error channels, unmount abort)"
  - "Chat golden frame sequences (goldenChatSuccess/Error/BareDone + goldenChatSyncReply)"
affects: [04-02, 04-03, chat-page, chat-composer, chat-transcript]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-feature imperative-stream-hook + pure-reducer (useChatStream + turnsReducer) reusing the shared lib/sse + connection.ts substrate, NOT a wrapper over useRunStream"
    - "Session seam: onOpen reads X-Session-Id (mirror of the X-Run-ID seam); reuse via request BODY session_id, never a header"
    - "Two error channels: non-2xx open/sync -> onSendError (send-failure); in-stream error frame -> in-bubble + conn closed"

key-files:
  created:
    - web/src/features/chat/api/schemas.ts
    - web/src/features/chat/api/client.ts
    - web/src/features/chat/api/stream.ts
    - web/src/features/chat/turns/reducer.ts
    - web/src/features/chat/turns/reducer.test.ts
    - web/src/features/chat/turns/useChatStream.ts
    - web/src/features/chat/turns/useChatStream.test.ts
    - web/src/features/chat/test/golden.ts
  modified: []

key-decisions:
  - "turnsReducer reads step text from data.answer (NOT content) and disambiguates step vs terminal by kind (done/error); no de-dup/ordinals/node-status (chat has no replay)"
  - "useChatStream sets openedRef=true on X-Session-Id arrival to mark a clean open — this distinguishes a live transport drop (->errored) from a non-2xx open with no event-stream body (->send-failure/onSendError)"
  - "Stop dispatches conn 'terminal' (->closed) BEFORE abort so the abort-induced onError/rejection can never flip closed->errored (D-05/Pitfall 4)"
  - "connReducer imported cross-feature from features/flow/timeline/connection (not copied/relocated) per the planner's surgical-scope choice"
  - "useChatStream.test mocks @/lib/sse via `await vi.hoisted(async () => (await import(...)).makeFakeSseStream())` to build the fake before the hoisted vi.mock factory runs"

patterns-established:
  - "Pattern: chat-specific useChatStream+turnsReducer mirror the Phase-3 useRunStream+timelineReducer STRUCTURE over the {kind,answer,error} envelope without inheriting flowd runId/replay/de-dup"
  - "Pattern: golden chat frame sequences live in web/src/features/chat/test/golden.ts using the shared frames() helper (chat-specific data shapes)"

requirements-completed: [CHAT-01, CHAT-02, CHAT-03]

# Metrics
duration: 6min
completed: 2026-06-04
---

# Phase 4 Plan 01: Typed /api/chat client + turnsReducer + useChatStream Summary

**Typed /api/chat layer (loose zod schemas + chatSync + chatStream over the reused openSseStream), a pure turnsReducer folding step/done/error/stop, and an imperative useChatStream hook (X-Session-Id capture + body-only reuse, Stop->closed-never-errored), all unit-tested against the Phase-3 fake SSE emitter — no live backend.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-06-04T06:41:21Z
- **Completed:** 2026-06-04T06:48:06Z
- **Tasks:** 3 (TDD)
- **Files created:** 8

## Accomplishments
- Locked the verified chat wire contract in code: `CHAT_BASE='/api/chat'`, body-only `session_id`, auth-none (Content-Type only), flat `{error}` envelope, loose `streamEnvelope` (`.loose()`), step-text-in-`answer`.
- Pure `turnsReducer` pins CHAT-01 + D-05 (stop keeps partial) + Pitfall 2 (answer-not-content) + Pitfall 5 (bare-done) with 9 unit tests.
- Imperative `useChatStream` proves the keystone with no backend: CHAT-01 lifecycle, CHAT-02 X-Session-Id capture-on-open + body-only reuse on turn 2, the operator-critical D-05 Stop->closed (never errored, even after a late abort rejection), transport-drop->errored, in-stream-error->in-bubble, non-2xx-open->send-failure, sync one-bubble fold, unmount abort — 10 unit tests.
- 247 tests green (baseline 228 + 19 new chat tests); full `npm run build` (tsc -b + vite build), tsc, and chat lint all pass.

## Task Commits

Each task committed atomically (TDD: test RED -> feat GREEN):

1. **Task 1: Chat schemas + client + stream wrapper + golden frames** - `08872ed` (feat)
2. **Task 2: Pure turnsReducer** - `da82b67` (test RED) -> `2c7de09` (feat GREEN)
3. **Task 3: useChatStream imperative hook** - `5a256f9` (test RED) -> `c36ae88` (feat GREEN)

_Task 1 is a non-behavioral api+golden layer verified by tsc-b (no separate test file by design — it is exercised by the Task 2/3 tests); Tasks 2 and 3 are full RED->GREEN cycles._

## Files Created/Modified
- `web/src/features/chat/api/schemas.ts` - zod chatRequest/chatResponse + loose streamEnvelope + flat chatError
- `web/src/features/chat/api/client.ts` - CHAT_BASE, ChatError, parseChatError (flat {error}), chatSync (Content-Type only, session in body)
- `web/src/features/chat/api/stream.ts` - chatStream over openSseStream + makeOnSession reading X-Session-Id
- `web/src/features/chat/test/golden.ts` - goldenChatSuccess/Error/BareDone (frames) + goldenChatSyncReply (sync JSON)
- `web/src/features/chat/turns/reducer.ts` - pure turnsReducer + initialTurns + the turn model
- `web/src/features/chat/turns/reducer.test.ts` - 9 reducer tests
- `web/src/features/chat/turns/useChatStream.ts` - imperative hook (send/sendSync/stop/newSession)
- `web/src/features/chat/turns/useChatStream.test.ts` - 10 hook tests

## Decisions Made
- **Step text from `answer`, kind-disambiguated terminal.** The reducer reads `payload.answer` for both step and done frames and treats `done`/`error` as terminal, everything else as a step row — no de-dup/ordinals/node-status (chat has no replay/late-join). (Pitfall 2.)
- **`openedRef` = clean-open marker.** `useChatStream` flips `openedRef` true when `X-Session-Id` arrives (the contract sets it before the first frame on a live event-stream). A `.catch`/`onError` then routes a live drop -> `transport-error` (errored) but a never-opened failure -> `onSendError` (send-failure). This cleanly separates the two error channels (Pitfall 3) using only the real wire signal.
- **Stop before abort.** `stop()` dispatches reducer `stop` + conn `terminal` (->closed) BEFORE `abort()`, so the abort-induced rejection cannot flip closed->errored (D-05 / Pitfall 4) — the connection's terminal-then-error guard holds it closed.
- **Cross-feature connReducer import.** Imported `connReducer` from `@/features/flow/timeline/connection` verbatim (no copy, no relocation) per the planner's surgical-scope choice (RESEARCH Open Question 1).

## Deviations from Plan

None - plan executed exactly as written. The api+golden layer (Task 1) is verified by tsc-b per the plan's `<verify>` block (it carries no standalone test file by design; it is exercised through the Task 2 reducer tests and Task 3 hook tests).

## Issues Encountered
- **vi.mock hoisting vs the shared fake emitter.** `vi.mock('@/lib/sse', () => ({ openSseStream: fake.openSseStream }))` is hoisted above module init, so a top-level `const fake = makeFakeSseStream()` is not yet initialized when the factory runs (and `vi.hoisted(() => makeFakeSseStream())` hit the same import-init-order error). Resolved with `const fake = await vi.hoisted(async () => { const { makeFakeSseStream } = await import('@/test/mocks/fetch-event-source'); return makeFakeSseStream() })`, which defers the import into the hoisted async factory. This is the canonical Vitest idiom for referencing a mock dependency from a hoisted factory.
- **One chat lint error** (a `&&` short-circuit expression in a `beforeEach` reset) was rewritten to a direct `splice(0)` statement; chat now lints clean.

## TDD Gate Compliance
Both behavior-adding tasks followed RED->GREEN: a `test(...)` commit precedes its `feat(...)` commit (Task 2: `da82b67`->`2c7de09`; Task 3: `5a256f9`->`c36ae88`). No REFACTOR commit was needed. Task 1 is a non-behavioral schema/client/golden layer (no `<behavior>`-driven source logic to red-test in isolation) verified by tsc-b and consumed by the Task 2/3 tests.

## Verification Results
- `cd web && npx vitest run src/features/chat` -> 2 files, 19 tests passed.
- `cd web && npm test` (full suite) -> 30 files, **247 tests passed** (baseline 228, no regression).
- `cd web && npm run build` (tsc -b + vite build) -> built clean (exit 0).
- `cd web && npx tsc -b --noEmit` -> exit 0.
- `cd web && npx eslint src/features/chat` -> clean (the 6 full-lint warnings are pre-existing TanStack-table warnings in flow/memory, out of scope).
- Grep gate `dangerouslySetInnerHTML` in `src/features/chat/` -> none.
- Grep gate auth/scope/session request header in `src/features/chat/api/` -> only doc comments + the single `response.headers.get('X-Session-Id')` READ in stream.ts (no request `.set`/header literal). Auth-none honored.
- **Session capture/reuse:** X-Session-Id captured via onOpen -> `sessionId`; turn 2 sends `{message, session_id}` in the BODY (asserted via `fake.captured().body`) with no X-Session-Id header.
- **Stop->closed:** stop mid-stream -> status `stopped`, two partial steps stay, conn `closed`; a late `fake.fail()` after stop does NOT flip to `errored`.
- **answer-not-content:** step rows are `{kind, text: payload.answer}`; the bare-done with empty answer settles `done` with `finalAnswer=''`.

## Next Phase Readiness
- The keystone logic (client + schemas + golden + turnsReducer + useChatStream) is unit-tested and ready for 04-02 (Slice A) and 04-03 (Slice B) to wire the ChatPage/composer/transcript UI onto.
- The send-failure channel (`onSendError`) is exposed for the UI to toast + re-enable the composer; the in-bubble error path is folded by the reducer.
- No blockers. No live backend needed for the test gate.

## Self-Check: PASSED

All 8 created files verified present on disk; all 5 task commits (`08872ed`, `da82b67`, `2c7de09`, `5a256f9`, `c36ae88`) verified in git history.

---
*Phase: 04-chat-console*
*Completed: 2026-06-04*
