---
phase: 4
slug: chat-console
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-04
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `04-RESEARCH.md` §Validation Architecture (chat contract verified from customer-support source).
> Keystone is provable WITHOUT a live backend by reusing the Phase-3 `vi.mock` fake SSE emitter.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.x + jsdom + @testing-library/react (established Phase 1, used Phases 2/3) |
| **Config file** | `web/vitest.config.ts` — reuse, no install |
| **Quick run command** | `cd web && npx vitest run src/features/chat` |
| **Full suite command** | `cd web && npm test` (`vitest run`) |
| **Estimated runtime** | ~20 seconds |

---

## How to test the chat stream deterministically (reuse the Phase-3 harness)

`vi.mock('@/lib/sse', () => ({ openSseStream: fake.openSseStream }))` with `makeFakeSseStream()`:
- `fake.emitOpen({ 'X-Session-Id': 'sess-1' })` drives `onOpen → onSession` (CHAT-02 session capture — mirrors the Phase-3 X-Run-ID seam).
- `fake.emit(frames([...]))` scripts chat `step`/`done`/`error` frames (each `StreamEnvelope{kind, answer, error}` — **step text is in `answer`, NOT `content`; no tool/args/result on the wire**).
- `fake.close()` = clean terminal → closed; the hook's `stop()` = closed + status `stopped` + partial steps remain; `fake.fail()` = errored (amber).
- Chat golden sequences (chat-specific, in `web/src/features/chat/`): `goldenChatSuccess` (step×2→done), `goldenChatError` (step→error), `goldenChatBareDone` (done, empty answer — Pitfall 5), `goldenChatSyncReply` (`{answer,agent,session_id}` JSON for the sync fetch).

---

## Per-Task Verification Map

> Task IDs assigned by the planner; rows keyed to requirements + behavior (RESEARCH §Phase Requirements → Test Map).

| Req | Slice | Behavior under test | Threat Ref | Test Type | Automated Command | File Exists | Status |
|-----|-------|---------------------|------------|-----------|-------------------|-------------|--------|
| CHAT-01 | B | `step` frames append trace rows in order; `done` sets final answer + collapses; `error` → in-bubble red | T-V5 | unit (reducer) | `vitest run src/features/chat/turns/reducer.test.ts` | ❌ W0 | ⬜ pending |
| CHAT-01 | B | streamed turn: open → steps live → done; streaming indicator while open | — | component | `vitest run src/features/chat/turns/useChatStream.test.ts` | ❌ W0 | ⬜ pending |
| CHAT-01 | B | **Stop keeps the partial + "Stopped"; connection→closed (NOT errored)** | — | component | `vitest run src/features/chat/turns/useChatStream.test.ts -t stop` | ❌ W0 | ⬜ pending |
| CHAT-02 | A/B | `X-Session-Id` read on open; reused as body `session_id` on turn 2 (NEVER a header) | T-V4 | component | `vitest run src/features/chat/turns/useChatStream.test.ts -t session` | ❌ W0 | ⬜ pending |
| CHAT-02 | A | "New session" clears transcript + resets id to "no session yet" | — | component | `vitest run src/features/chat/ChatPage.test.tsx -t "new session"` | ❌ W0 | ⬜ pending |
| CHAT-03 | A | sync `/chat` reply renders into the SAME assistant bubble (no trace) | — | component | `vitest run src/features/chat/ChatPage.test.tsx -t sync` | ❌ W0 | ⬜ pending |
| CHAT-01/03 | A/B | 429/non-2xx send-failure → toast + composer re-enables (NOT in-bubble red) | — | component | `vitest run src/features/chat/ChatPage.test.tsx -t "send failed"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `web/src/features/chat/turns/reducer.test.ts` — CHAT-01 (fold step/done/error; stop keeps partial)
- [ ] `web/src/features/chat/turns/useChatStream.test.ts` — CHAT-01/02 (stream lifecycle, session capture+reuse, Stop→closed)
- [ ] `web/src/features/chat/ChatPage.test.tsx` — CHAT-02/03 (new-session reset, sync-into-same-bubble, 429 toast)
- [ ] Chat golden frame sequences in `web/src/features/chat/` (reuse `frames()` from the shared flow mock)
- [ ] No framework install — Vitest + jsdom + RTL already configured (Phase 1/3). Reuse `lib/sse.ts`, `connection.ts`, `makeFakeSseStream` verbatim.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live streamed chat against real customer-support through nginx | CHAT-01 | Needs a running customer-support + fronting nginx + browser; Docker unreachable in sandbox | With the stack up: send a message; confirm agent steps render incrementally (per-event flush, not batched) and the session id persists across turns |
| Session continuity round-trip against the live service | CHAT-02 | Server-assigned `X-Session-Id` → body reuse needs the real service | Send turn 1, confirm `X-Session-Id` appears + is shown; send turn 2, confirm the same id is reused in the request body |

*The reducer, stream lifecycle, session capture/reuse logic, Stop-keeps-partial, sync-into-bubble, and 429-toast are fully automated above (fake emitter); these two need the live service a unit test can't supply.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
