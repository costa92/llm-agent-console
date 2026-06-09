/**
 * The connection-state machine (03-RESEARCH.md "connection-state machine"; D-02).
 *
 * A small PURE transition function over a TYPED UNION — deliberately not a
 * boolean — so Phase 5 can insert a 'reconnecting' state between 'streaming' and
 * 'errored' as a purely additive change, with no caller rewrites. flow_done AND
 * flow_err are BOTH terminal frames (Pitfall 6): each closes the connection. The
 * connection state is transport-level only — success vs failure of the RUN is
 * the terminal FRAME's job (the timeline's `terminal`), not the connection's.
 *
 * Phase 5 (05-02): added 'reconnecting' state. On a transport drop (no terminal
 * frame), the machine enters 'reconnecting' instead of immediately 'errored'.
 * Cap exhaustion (reconnect-give-up) is the ONLY path to 'errored'. Terminal
 * ALWAYS wins — even mid-reconnect it settles 'closed' (no reconnect storms).
 */

/** The transport connection state. Extended in Phase 5 with 'reconnecting'. */
export type ConnState = 'idle' | 'streaming' | 'reconnecting' | 'closed' | 'errored'

/** Events that drive the connection machine. */
export type ConnEvent =
  | { type: 'start' }             // a stream was opened
  | { type: 'terminal' }          // a terminal frame arrived (flow_done OR flow_err)
  | { type: 'transport-error' }   // the transport dropped with no terminal frame
  | { type: 'reconnect-success' } // the reconnect attempt succeeded → back to streaming
  | { type: 'reconnect-give-up' } // cap exhausted → errored (the ONLY path to errored)
  | { type: 'reset' }             // re-arm to idle (a fresh run)

/** The starting state. */
export const initialConn: ConnState = 'idle'

/**
 * Pure transition. Guards:
 * - `terminal` always settles to 'closed' (it is the authoritative end of the
 *   stream; it wins even over a prior transport error or mid-reconnect — D-03
 *   no reconnect storms).
 * - `transport-error` is IGNORED once already 'closed' — a late onError after a
 *   terminal frame must not flip a cleanly-closed stream to 'errored'.
 * - `transport-error` while 'reconnecting' is idempotent — the loop owns give-up.
 * - `transport-error` while 'streaming' → 'reconnecting' (was 'errored' in Phase 3/4).
 * - `reconnect-give-up` is the ONLY path from 'reconnecting' to 'errored'.
 */
export function connReducer(state: ConnState, event: ConnEvent): ConnState {
  switch (event.type) {
    case 'reset':
      return 'idle'
    case 'start':
      return 'streaming'
    case 'terminal':
      // Terminal ALWAYS wins — even mid-reconnect. No reconnect storms.
      return state === 'idle' ? 'idle' : 'closed'
    case 'transport-error':
      if (state === 'closed') return 'closed'       // terminal-then-error guard (KEEP)
      if (state === 'reconnecting') return 'reconnecting' // idempotent; loop owns give-up
      if (state === 'streaming') return 'reconnecting'    // Phase 5: drop → reconnecting
      return state                                    // idle / errored: no-op
    case 'reconnect-success':
      return 'streaming'
    case 'reconnect-give-up':
      return 'errored'
    default:
      return state
  }
}
