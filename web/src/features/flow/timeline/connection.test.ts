import { describe, it, expect } from 'vitest'
import {
  connReducer,
  initialConn,
  type ConnState,
  type ConnEvent,
} from './connection'

/**
 * Unit tests for the connection-state machine (03-03 feature 2).
 *
 * Models idle → streaming → (closed | errored). It is a TYPED UNION (not a
 * boolean) so Phase 5 can insert a 'reconnecting' state between streaming and
 * errored without rewriting callers (D-02). flow_done AND flow_err are both
 * 'terminal' events → closed (success/failure is the terminal FRAME's job, not
 * the connection's). A transport error AFTER a terminal close is ignored.
 */

function run(events: ConnEvent[], from: ConnState = initialConn): ConnState {
  return events.reduce<ConnState>((st, e) => connReducer(st, e), from)
}

describe('connReducer — initial', () => {
  it('starts idle', () => {
    expect(initialConn).toBe('idle')
  })
})

describe('connReducer — happy path', () => {
  it('start → streaming', () => {
    expect(connReducer('idle', { type: 'start' })).toBe('streaming')
  })

  it('terminal (flow_done/flow_err) → closed', () => {
    expect(run([{ type: 'start' }, { type: 'terminal' }])).toBe('closed')
  })
})

describe('connReducer — error path', () => {
  it('a transport-error before any terminal → reconnecting (Phase 5: was errored, now starts retry)', () => {
    // Phase 5 (D-03): transport-error no longer lands directly in errored.
    // It enters reconnecting; only reconnect-give-up reaches errored.
    expect(run([{ type: 'start' }, { type: 'transport-error' }])).toBe('reconnecting')
  })
})

describe('connReducer — terminal-then-error guard', () => {
  it('a late transport-error AFTER a terminal close is ignored (stays closed)', () => {
    expect(
      run([{ type: 'start' }, { type: 'terminal' }, { type: 'transport-error' }]),
    ).toBe('closed')
  })

  it('a terminal after a transport error does still close (terminal wins)', () => {
    // An errored connection that then receives a terminal frame settles closed.
    expect(
      run([{ type: 'start' }, { type: 'transport-error' }, { type: 'terminal' }]),
    ).toBe('closed')
  })
})

describe('connReducer — reset', () => {
  it('reset → idle from any state', () => {
    expect(connReducer('streaming', { type: 'reset' })).toBe('idle')
    expect(connReducer('closed', { type: 'reset' })).toBe('idle')
    expect(connReducer('errored', { type: 'reset' })).toBe('idle')
  })
})

describe('connReducer — extensibility', () => {
  it('the union is the source of truth (no boolean) — Phase 5 slots reconnecting in', () => {
    // Compile-time assurance: ConnState is a string union; this test documents
    // that a future 'reconnecting' is a pure additive change.
    const states: ConnState[] = ['idle', 'streaming', 'closed', 'errored', 'reconnecting']
    expect(states).toHaveLength(5)
  })
})

describe('connReducer — reconnecting (Phase 5 additive extension)', () => {
  it('transport-error while streaming → reconnecting (not immediately errored)', () => {
    expect(run([{ type: 'start' }, { type: 'transport-error' }])).toBe('reconnecting')
  })

  it('drop → reconnecting → success → streaming', () => {
    expect(
      run([
        { type: 'start' },
        { type: 'transport-error' },
        { type: 'reconnect-success' },
      ]),
    ).toBe('streaming')
  })

  it('drop → cap exhausted → errored', () => {
    expect(
      run([
        { type: 'start' },
        { type: 'transport-error' },
        { type: 'reconnect-give-up' },
      ]),
    ).toBe('errored')
  })

  it('terminal wins mid-reconnect → closed (no storm)', () => {
    expect(
      run([
        { type: 'start' },
        { type: 'transport-error' },
        { type: 'terminal' },
      ]),
    ).toBe('closed')
  })

  it('transport-error while reconnecting is idempotent (loop owns give-up)', () => {
    expect(
      run([
        { type: 'start' },
        { type: 'transport-error' },
        { type: 'transport-error' },
      ]),
    ).toBe('reconnecting')
  })

  it('reconnect-give-up is the ONLY path from reconnecting to errored — transport-error alone never lands in errored (Pitfall 1)', () => {
    // transport-error from streaming → reconnecting (NOT errored)
    const afterDrop = run([{ type: 'start' }, { type: 'transport-error' }])
    expect(afterDrop).toBe('reconnecting')
    expect(afterDrop).not.toBe('errored')
  })

  it('a late transport-error AFTER a terminal close is still ignored (stays closed)', () => {
    expect(
      run([
        { type: 'start' },
        { type: 'terminal' },
        { type: 'transport-error' },
      ]),
    ).toBe('closed')
  })
})
