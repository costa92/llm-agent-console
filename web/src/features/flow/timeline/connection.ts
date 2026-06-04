/**
 * The connection-state machine (03-RESEARCH.md "connection-state machine"; D-02).
 *
 * A small PURE transition function over a TYPED UNION — deliberately not a
 * boolean — so Phase 5 can insert a 'reconnecting' state between 'streaming' and
 * 'errored' as a purely additive change, with no caller rewrites. flow_done AND
 * flow_err are BOTH terminal frames (Pitfall 6): each closes the connection. The
 * connection state is transport-level only — success vs failure of the RUN is
 * the terminal FRAME's job (the timeline's `terminal`), not the connection's.
 */

/** The transport connection state. EXTENSIBLE — Phase 5 adds 'reconnecting'. */
export type ConnState = 'idle' | 'streaming' | 'closed' | 'errored'

/** Events that drive the connection machine. */
export type ConnEvent =
  | { type: 'start' } // a stream was opened
  | { type: 'terminal' } // a terminal frame arrived (flow_done OR flow_err)
  | { type: 'transport-error' } // the transport dropped with no terminal frame
  | { type: 'reset' } // re-arm to idle (a fresh run)

/** The starting state. */
export const initialConn: ConnState = 'idle'

/**
 * Pure transition. Guards:
 * - `terminal` always settles to 'closed' (it is the authoritative end of the
 *   stream; it wins even over a prior transport error).
 * - `transport-error` is IGNORED once already 'closed' — a late onError after a
 *   terminal frame must not flip a cleanly-closed stream to 'errored'.
 */
export function connReducer(state: ConnState, event: ConnEvent): ConnState {
  switch (event.type) {
    case 'reset':
      return 'idle'
    case 'start':
      return 'streaming'
    case 'terminal':
      return 'closed'
    case 'transport-error':
      // Already cleanly closed → ignore (terminal-then-error guard).
      return state === 'closed' ? 'closed' : 'errored'
    default:
      return state
  }
}
