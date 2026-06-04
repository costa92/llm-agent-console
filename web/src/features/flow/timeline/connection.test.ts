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
  it('a transport-error before any terminal → errored', () => {
    expect(run([{ type: 'start' }, { type: 'transport-error' }])).toBe('errored')
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
    const states: ConnState[] = ['idle', 'streaming', 'closed', 'errored']
    expect(states).toHaveLength(4)
  })
})
