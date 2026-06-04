import { frames, type SseFrame } from '@/test/mocks/fetch-event-source'

/**
 * Chat golden frame sequences — the VERIFIED customer-support `step`/`done`/
 * `error` shapes (04-RESEARCH.md "How to test the stream deterministically").
 *
 * Built with the SHARED `frames()` helper from the Phase-3 fake-emitter mock so
 * the same harness scripts chat frames; the data shapes are chat-specific
 * (`{kind, answer?, error?}` StreamEnvelopes). Each `step` frame carries its text
 * in `answer` (NOT `content` — Pitfall 2). Exactly ONE terminal frame
 * (`done`/`error`), then the stream closes.
 */

/** step (thought) → step (action) → done — the happy path (CHAT-01). */
export const goldenChatSuccess: SseFrame[] = frames([
  { kind: 'step', payload: { kind: 'thought', answer: 'Looking up the order status…' } },
  { kind: 'step', payload: { kind: 'action', answer: 'lookup_order(42)' } },
  { kind: 'done', payload: { kind: 'done', answer: 'Your order ships tomorrow.' } },
])

/** step → error — a mid-stream agent failure (in-bubble red, D-01 stop-on-error). */
export const goldenChatError: SseFrame[] = frames([
  { kind: 'step', payload: { kind: 'thought', answer: 'Checking inventory…' } },
  { kind: 'error', payload: { kind: 'error', error: 'tool call failed' } },
])

/**
 * done with an EMPTY answer — the bare-done edge case (Pitfall 5, the
 * `ev.Final == nil` branch). The reducer still settles to status='done' with
 * finalAnswer=''; the UI renders a muted "(no answer returned)".
 */
export const goldenChatBareDone: SseFrame[] = frames([
  { kind: 'done', payload: { kind: 'done' } },
])

/**
 * The sync `/chat` reply JSON (NOT an SSE frame) — `{ answer, agent, session_id }`
 * for the sync-fold test (CHAT-03). A plain object, not built with frames().
 */
export const goldenChatSyncReply = {
  answer: 'Your order ships tomorrow.',
  agent: 'support-bot',
  session_id: 'sess-sync-1',
} as const
