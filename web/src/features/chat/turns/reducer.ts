import type { StreamEnvelope } from '@/features/chat/api/schemas'

/**
 * The pure chat turn reducer (04-RESEARCH.md Pattern 2 "pure turnsReducer").
 *
 * Far simpler than the flow `timelineReducer`: chat has no replay/late-join, so
 * there is NO de-dup, NO ordinals, NO node-status map. It folds the verified
 * `step`/`done`/`error` SSE log into a flat list of turns. The active assistant
 * turn accumulates `step` rows (append-only) then settles to a `finalAnswer`
 * (done) or `error` (error). Both `step` and `done` read their text from
 * `answer` (Pitfall 2); `kind` disambiguates a step from the terminal markers.
 *
 * PURE — no React, no network. The hook parses each SSE frame loosely and
 * dispatches an already-shaped action; the reducer never touches the wire.
 */

/** A single agent step row: `text` is the frame's `answer` (Pitfall 2). */
export type StepRow = { kind: string; text: string }

/** A user message turn. */
export type UserTurn = { role: 'user'; text: string }

/** An assistant turn — the streamed/synced reply surface (one bubble, D-03). */
export type AssistantTurn = {
  role: 'assistant'
  steps: StepRow[]
  /** From a `done` frame's `answer` (may be '' — Pitfall 5) or the sync reply. */
  finalAnswer?: string
  /** From an `error` frame's `error` (in-bubble red, D-01). */
  error?: string
  status: 'streaming' | 'done' | 'error' | 'stopped'
}

export type Turn = UserTurn | AssistantTurn

/** The full transcript state. */
export type ChatTurns = { turns: Turn[] }

export const initialTurns: ChatTurns = { turns: [] }

export type ChatAction =
  /** A user pressed send: append the user message + a fresh streaming assistant turn. */
  | { type: 'startUser'; message: string }
  /** A parsed SSE frame: kind 'done'/'error' is terminal, anything else is a step. */
  | { type: 'frame'; kind: string; payload: StreamEnvelope }
  /** Operator Stop: settle the active turn to 'stopped', KEEP partials (D-05). */
  | { type: 'stop' }
  /** The sync one-shot reply: fill the active assistant turn directly (CHAT-03). */
  | { type: 'syncReply'; answer: string }
  /** New session: clear the transcript to empty (D-06). */
  | { type: 'reset' }

/**
 * Map over the active (last) assistant turn. If the last turn is not an
 * assistant turn (defensive — should not happen in normal flow), state is
 * returned unchanged.
 */
function withActiveAssistant(
  state: ChatTurns,
  fn: (turn: AssistantTurn) => AssistantTurn,
): ChatTurns {
  const idx = state.turns.length - 1
  const last = state.turns[idx]
  if (!last || last.role !== 'assistant') return state
  const turns = state.turns.slice()
  turns[idx] = fn(last)
  return { turns }
}

export function turnsReducer(state: ChatTurns, action: ChatAction): ChatTurns {
  switch (action.type) {
    case 'reset':
      return initialTurns

    case 'startUser': {
      const user: UserTurn = { role: 'user', text: action.message }
      const assistant: AssistantTurn = { role: 'assistant', steps: [], status: 'streaming' }
      return { turns: [...state.turns, user, assistant] }
    }

    case 'frame': {
      if (action.kind === 'done') {
        return withActiveAssistant(state, (t) => ({
          ...t,
          finalAnswer: action.payload.answer ?? '',
          status: 'done',
        }))
      }
      if (action.kind === 'error') {
        return withActiveAssistant(state, (t) => ({
          ...t,
          error: action.payload.error ?? '',
          status: 'error',
        }))
      }
      // Any other kind is a step row — text comes from `answer` (Pitfall 2).
      // An unknown future kind is kept verbatim (loose), never dropped.
      const row: StepRow = { kind: action.kind, text: action.payload.answer ?? '' }
      return withActiveAssistant(state, (t) => ({ ...t, steps: [...t.steps, row] }))
    }

    case 'stop':
      // D-05: operator-initiated. Keep every partial step + any finalAnswer.
      return withActiveAssistant(state, (t) => ({ ...t, status: 'stopped' }))

    case 'syncReply':
      // CHAT-03: one assistant bubble, NO trace — set the answer directly.
      return withActiveAssistant(state, (t) => ({
        ...t,
        finalAnswer: action.answer,
        status: 'done',
      }))

    default:
      return state
  }
}
