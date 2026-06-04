import { describe, it, expect } from 'vitest'
import { turnsReducer, initialTurns, type AssistantTurn } from './reducer'
import {
  goldenChatSuccess,
  goldenChatError,
  goldenChatBareDone,
  goldenChatSyncReply,
} from '@/features/chat/test/golden'
import { streamEnvelopeSchema } from '@/features/chat/api/schemas'
import type { ChatTurns } from './reducer'

/**
 * Unit tests for the PURE turnsReducer (04-01 Task 2).
 *
 * The reducer takes already-shaped actions (the hook parses each SSE frame
 * loosely and dispatches a `frame` action). These tests parse the golden frames
 * the same way the hook will — loose `streamEnvelopeSchema` — then fold them, so
 * the verified `{kind, answer?, error?}` shapes drive the assertions.
 *
 * Pins: step text from `answer` (Pitfall 2), done sets finalAnswer + collapses,
 * bare-done records empty answer (Pitfall 5), error in-bubble, Stop keeps the
 * partial (D-05), unknown kind kept, new-session clears (D-06), sync one-bubble.
 */

/** Parse a golden SSE frame the way the hook will (loose) → a `frame` action. */
function frameAction(f: { event?: string; data: string }) {
  const env = streamEnvelopeSchema.parse(JSON.parse(f.data))
  return { type: 'frame' as const, kind: env.kind, payload: env }
}

/** Open a fresh streaming turn from a user message, then fold the frames. */
function streamTurn(message: string, golden: { event?: string; data: string }[]) {
  let state: ChatTurns = turnsReducer(initialTurns, {
    type: 'startUser',
    message,
  })
  for (const f of golden) state = turnsReducer(state, frameAction(f))
  return state
}

/** The active (last) assistant turn. */
function lastAssistant(state: ChatTurns): AssistantTurn {
  const t = state.turns[state.turns.length - 1]
  if (t.role !== 'assistant') throw new Error('last turn is not assistant')
  return t
}

describe('turnsReducer — startUser appends a user turn + a fresh streaming assistant turn', () => {
  it('appends [user, assistant(streaming, empty steps)]', () => {
    const state = turnsReducer(initialTurns, { type: 'startUser', message: 'hi' })
    expect(state.turns).toHaveLength(2)
    expect(state.turns[0]).toEqual({ role: 'user', text: 'hi' })
    const asst = lastAssistant(state)
    expect(asst.status).toBe('streaming')
    expect(asst.steps).toEqual([])
    expect(asst.finalAnswer).toBeUndefined()
    expect(asst.error).toBeUndefined()
  })
})

describe('turnsReducer — step frames append trace rows from `answer` (Pitfall 2)', () => {
  it('pushes {kind, text:answer} rows in arrival order, status stays streaming', () => {
    let state = turnsReducer(initialTurns, { type: 'startUser', message: 'q' })
    // only the two leading step frames (drop the terminal done)
    const steps = goldenChatSuccess.slice(0, 2)
    for (const f of steps) state = turnsReducer(state, frameAction(f))

    const asst = lastAssistant(state)
    expect(asst.status).toBe('streaming')
    expect(asst.steps).toEqual([
      { kind: 'thought', text: 'Looking up the order status…' },
      { kind: 'action', text: 'lookup_order(42)' },
    ])
  })
})

describe('turnsReducer — done sets finalAnswer + status done, steps preserved (D-01)', () => {
  it('folds step×2 → done into a collapsed answer with the trace kept', () => {
    const state = streamTurn('q', goldenChatSuccess)
    const asst = lastAssistant(state)
    expect(asst.status).toBe('done')
    expect(asst.finalAnswer).toBe('Your order ships tomorrow.')
    expect(asst.steps).toHaveLength(2)
    expect(asst.error).toBeUndefined()
  })
})

describe('turnsReducer — bare done with empty answer still settles done (Pitfall 5)', () => {
  it('records finalAnswer="" + status done', () => {
    const state = streamTurn('q', goldenChatBareDone)
    const asst = lastAssistant(state)
    expect(asst.status).toBe('done')
    expect(asst.finalAnswer).toBe('')
    expect(asst.steps).toEqual([])
  })
})

describe('turnsReducer — error frame sets error + status error, partials kept (D-01 stop-on-error)', () => {
  it('folds step → error into an in-bubble error with the trace kept', () => {
    const state = streamTurn('q', goldenChatError)
    const asst = lastAssistant(state)
    expect(asst.status).toBe('error')
    expect(asst.error).toBe('tool call failed')
    expect(asst.steps).toEqual([{ kind: 'thought', text: 'Checking inventory…' }])
    expect(asst.finalAnswer).toBeUndefined()
  })
})

describe('turnsReducer — stop keeps the partial steps/answer (D-05)', () => {
  it('sets status=stopped and PRESERVES the accumulated steps', () => {
    // mid-stream: two steps in, no terminal frame yet
    let state = turnsReducer(initialTurns, { type: 'startUser', message: 'q' })
    for (const f of goldenChatSuccess.slice(0, 2)) {
      state = turnsReducer(state, frameAction(f))
    }
    state = turnsReducer(state, { type: 'stop' })

    const asst = lastAssistant(state)
    expect(asst.status).toBe('stopped')
    expect(asst.steps).toHaveLength(2)
    expect(asst.finalAnswer).toBeUndefined()
    expect(asst.error).toBeUndefined()
  })
})

describe('turnsReducer — an unknown step kind is kept verbatim (loose), never crashes', () => {
  it('keeps an unknown kind as a neutral step row', () => {
    let state = turnsReducer(initialTurns, { type: 'startUser', message: 'q' })
    state = turnsReducer(state, {
      type: 'frame',
      kind: 'speculation', // not in the six StepKinds — a future kind
      payload: { kind: 'speculation', answer: 'maybe it ships tomorrow' },
    })
    const asst = lastAssistant(state)
    expect(asst.status).toBe('streaming')
    expect(asst.steps).toEqual([
      { kind: 'speculation', text: 'maybe it ships tomorrow' },
    ])
  })
})

describe('turnsReducer — reset/newSession clears all turns (D-06)', () => {
  it('returns to empty turns', () => {
    const state = streamTurn('q', goldenChatSuccess)
    expect(state.turns.length).toBeGreaterThan(0)
    const cleared = turnsReducer(state, { type: 'reset' })
    expect(cleared).toEqual(initialTurns)
    expect(cleared.turns).toEqual([])
  })
})

describe('turnsReducer — sync reply fills one assistant bubble with NO steps (CHAT-03)', () => {
  it('startUser then syncReply sets finalAnswer directly, status done, empty steps', () => {
    let state = turnsReducer(initialTurns, { type: 'startUser', message: 'q' })
    state = turnsReducer(state, {
      type: 'syncReply',
      answer: goldenChatSyncReply.answer,
    })
    const asst = lastAssistant(state)
    expect(asst.status).toBe('done')
    expect(asst.finalAnswer).toBe('Your order ships tomorrow.')
    expect(asst.steps).toEqual([])
  })
})
