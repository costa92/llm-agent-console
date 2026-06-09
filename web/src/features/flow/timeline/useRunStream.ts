import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { runStream, replayStream } from '@/features/flow/api/stream'
import { listRunEvents } from '@/features/flow/api/client'
import type { SseKind, SsePayload } from '@/features/flow/api/schemas'
import {
  timelineReducer,
  initialTimeline,
  type Timeline,
} from './reducer'
import { connReducer, initialConn, type ConnState } from './connection'
import { nextDelay, DEFAULT_BACKOFF } from './backoff'

/**
 * The imperative SSE hook (03-RESEARCH.md "imperative SSE hook feeding a pure
 * reducer"). It is the only stateful, side-effecting unit in the keystone — it
 * wraps the pure `timelineReducer` + connection machine and the 03-01 stream
 * wrappers (`runStream`/`replayStream`) + REST client (`listRunEvents`).
 *
 * Responsibilities:
 * - start(flowId, inputs, opts?) → open a live `/run/stream`, reset the reducer,
 *   set conn 'streaming', fold each frame into the reducer in arrival order.
 * - surface the live run_id from flowd's `X-Run-ID` (03-01 onRunId): store it +
 *   invoke opts.onRunId so the caller can navigate to /flows/{id}/runs/{runId}
 *   (D-08); also expose it as the returned `runId`.
 * - on a terminal frame (flow_done/flow_err): conn 'closed' + abort the fetch so
 *   flowd's r.Context() cancels and the run cannot leak (Pitfall 6 / T-03-06).
 * - on a transport drop before any terminal (05-03 D-03): enters 'reconnecting',
 *   drives the capped-backoff loop → retry() via /events (de-dup) → resume or
 *   cap exhaustion → 'errored'. Timer cleared on terminal/success/unmount/reset.
 * - retry() (D-09 / IC-6): if a run_id is KNOWN, recover by hydrating GET
 *   /runs/{id}/events as `source:'history'` (the reducer de-dups so nothing
 *   doubles) — NOT a fresh /run/stream POST (that would start a NEW run). If no
 *   run_id is known yet, retry() re-opens runStream (a genuinely new attempt).
 * - replay(runId): open `/replay`, feeding the SAME reducer with source:'history'.
 * - unmount aborts the in-flight stream AND clears any pending reconnect timer.
 */

export type StartOpts = {
  /** Invoked once with the live run_id when flowd's X-Run-ID arrives (D-08). */
  onRunId?: (runId: string) => void
}

/**
 * Optional hook-level overrides, used for testing (rng injection lets tests
 * produce a deterministic nextDelay of ~0 without fake timers).
 */
export type UseRunStreamOpts = {
  /** Override Math.random for backoff jitter — inject () => 0 in tests. */
  rng?: () => number
}

export type UseRunStream = {
  timeline: Timeline
  conn: ConnState
  /** The live/replayed run_id once known (from X-Run-ID), else undefined. */
  runId: string | undefined
  /** Current reconnect attempt (1-based; 0 when not reconnecting). Exposed for badge (n/N). */
  attempt: number
  /** Maximum reconnect attempts cap (DEFAULT_BACKOFF.cap). Exposed for badge (n/N). */
  cap: number
  start: (
    flowId: string,
    inputs: Record<string, string>,
    opts?: StartOpts,
  ) => void
  replay: (runId: string) => void
  retry: () => Promise<void>
}

export function useRunStream(hookOpts: UseRunStreamOpts = {}): UseRunStream {
  const { rng = Math.random } = hookOpts

  const [timeline, dispatch] = useReducer(timelineReducer, initialTimeline)
  const [conn, dispatchConn] = useReducer(connReducer, initialConn)
  const [runId, setRunId] = useState<string | undefined>(undefined)
  const [attempt, setAttempt] = useState<number>(0)

  const abortRef = useRef<AbortController | null>(null)
  const runIdRef = useRef<string | undefined>(undefined)
  /** Remember the last start args so retry() can re-open a never-created run. */
  const lastStartRef = useRef<{
    flowId: string
    inputs: Record<string, string>
    opts?: StartOpts
  } | null>(null)

  /** Reconnect loop mutable state (05-03 D-03). */
  const attemptRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef<boolean>(true)

  /**
   * A single stable "context" ref that bundles all mutable values the reconnect
   * loop needs. Updated in a useEffect so the loop always reads the latest values
   * without violating react-hooks/refs (no updates in the render body).
   */
  const ctxRef = useRef({
    rng,
    dispatch,
    dispatchConn,
    setAttempt,
  })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { ctxRef.current = { rng, dispatch, dispatchConn, setAttempt } })

  /** Abort any in-flight stream and forget the controller. */
  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  /** Clear the reconnect timer and reset the attempt counter (Pitfall 4). */
  const clearReconnect = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    attemptRef.current = 0
    ctxRef.current.setAttempt(0)
  }, [])

  /**
   * A stable ref holding the scheduleReconnect function so the timer callback
   * can call it recursively without a stale closure or TDZ forward reference.
   * The ref is populated immediately after scheduleReconnect is defined.
   */
  const scheduleReconnectRef = useRef<() => void>(() => {})

  /**
   * The reconnect loop — stable useCallback, reads all mutable state through
   * ctxRef / other refs. Recursive via scheduleReconnectRef to avoid TDZ.
   */
  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return

    attemptRef.current += 1
    ctxRef.current.setAttempt(attemptRef.current)

    if (attemptRef.current > DEFAULT_BACKOFF.cap) {
      // Cap exhausted → the ONLY path to 'errored'.
      clearReconnect()
      ctxRef.current.dispatchConn({ type: 'reconnect-give-up' })
      return
    }

    const delay = nextDelay(attemptRef.current - 1, DEFAULT_BACKOFF, ctxRef.current.rng)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (!mountedRef.current) return

      const knownRunId = runIdRef.current
      if (knownRunId) {
        // D-09 / IC-6: hydrate GET /events — reducer de-dups against the live prefix.
        listRunEvents(knownRunId).then(
          (events) => {
            if (!mountedRef.current) return
            for (const ev of events) {
              ctxRef.current.dispatch({
                type: 'event',
                source: 'history',
                kind: ev.kind,
                payload: ev.payload,
                seq: ev.seq,
              })
            }
            const lastKind = events[events.length - 1]?.kind
            if (lastKind === 'flow_done' || lastKind === 'flow_err') {
              // Terminal in history → settled closed; no further loop.
              clearReconnect()
              ctxRef.current.dispatchConn({ type: 'terminal' })
            } else {
              // Non-terminal → run still in-flight; reconnect succeeded.
              clearReconnect()
              ctxRef.current.dispatchConn({ type: 'reconnect-success' })
            }
          },
          () => {
            // listRunEvents failed — schedule next attempt via the stable ref.
            if (mountedRef.current) scheduleReconnectRef.current()
          },
        )
      } else {
        // No run_id known (stream died before X-Run-ID) → genuinely new attempt.
        const lastStart = lastStartRef.current
        if (lastStart && mountedRef.current) {
          clearReconnect()
          startRef.current.fn(lastStart.flowId, lastStart.inputs, lastStart.opts)
        }
      }
    }, delay)
  }, [clearReconnect])

  // Keep the scheduleReconnectRef in sync with the latest scheduleReconnect.
  useEffect(() => { scheduleReconnectRef.current = scheduleReconnect }, [scheduleReconnect])

  /** Fold one SSE frame into the reducer; close+abort on a terminal frame. */
  const onFrame = useCallback(
    (source: 'live' | 'history', event: string | undefined, data: string) => {
      const kind = event as SseKind
      let payload: SsePayload
      try {
        payload = JSON.parse(data) as SsePayload
      } catch {
        return // a malformed frame is dropped rather than crashing the timeline
      }
      dispatch({ type: 'event', source, kind, payload })
      if (kind === 'flow_done' || kind === 'flow_err') {
        // Terminal ALWAYS wins — clear any pending reconnect timer (Pitfall 4).
        clearReconnect()
        dispatchConn({ type: 'terminal' })
        abort() // terminal → no leaked fetch (Pitfall 6)
      }
    },
    [abort, clearReconnect],
  )

  const start = useCallback(
    (flowId: string, inputs: Record<string, string>, opts?: StartOpts) => {
      clearReconnect()
      abort()
      const ac = new AbortController()
      abortRef.current = ac
      lastStartRef.current = { flowId, inputs, opts }
      runIdRef.current = undefined
      setRunId(undefined)
      dispatch({ type: 'reset' })
      dispatchConn({ type: 'reset' })
      dispatchConn({ type: 'start' })

      runStream(
        flowId,
        inputs,
        {
          onRunId: (id) => {
            runIdRef.current = id
            setRunId(id)
            opts?.onRunId?.(id)
          },
          onMessage: ({ event, data }) => onFrame('live', event, data),
          onError: () => {
            // 05-03 D-03: transport drop → reconnecting, then drive the loop.
            dispatchConn({ type: 'transport-error' })
            scheduleReconnect()
          },
        },
        ac.signal,
      ).catch(() => {
        // fetch-event-source rejects on abort (incl. our own terminal abort) —
        // a transport drop already routed through onError; ignore here.
      })
    },
    [abort, clearReconnect, onFrame, scheduleReconnect],
  )

  /**
   * Stable ref so the reconnect loop can call start without stale closure.
   * We use a plain object ref (not passed as arg to useRef) and update it in
   * a useEffect — the canonical "latest-value ref" pattern. The eslint-disable
   * is intentional: the react-hooks/immutability rule does not apply here
   * because the ref container was NOT passed as argument to any other hook.
   */
  const startRef = useRef<{ fn: typeof start }>({ fn: start })
  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => { startRef.current.fn = start }, [start])

  const replay = useCallback(
    (id: string) => {
      clearReconnect()
      abort()
      const ac = new AbortController()
      abortRef.current = ac
      runIdRef.current = id
      setRunId(id)
      dispatch({ type: 'reset' })
      dispatchConn({ type: 'reset' })
      dispatchConn({ type: 'start' })

      replayStream(
        id,
        {
          onMessage: ({ event, data }) => onFrame('history', event, data),
          onError: () => dispatchConn({ type: 'transport-error' }),
        },
        ac.signal,
      ).catch(() => {})
    },
    [abort, clearReconnect, onFrame],
  )

  /** Public retry() — callable by the operator (e.g. Retry button).
   *  Resets the attempt counter and fires immediately (no timer). */
  const retry = useCallback(async () => {
    const knownRunId = runIdRef.current
    if (knownRunId) {
      clearReconnect()
      const events = await listRunEvents(knownRunId)
      for (const ev of events) {
        dispatch({
          type: 'event',
          source: 'history',
          kind: ev.kind,
          payload: ev.payload,
          seq: ev.seq,
        })
      }
      const lastKind = events[events.length - 1]?.kind
      if (lastKind === 'flow_done' || lastKind === 'flow_err') {
        dispatchConn({ type: 'terminal' })
      }
      return
    }
    // No run_id known (the stream died before X-Run-ID) → a genuinely new attempt.
    const lastStart = lastStartRef.current
    if (lastStart) {
      start(lastStart.flowId, lastStart.inputs, lastStart.opts)
    }
  }, [clearReconnect, start])

  // Abort the in-flight stream on unmount + clear any reconnect timer (Pitfall 4).
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearReconnect()
      abortRef.current?.abort()
    }
  }, [clearReconnect])

  return {
    timeline,
    conn,
    runId,
    attempt,
    cap: DEFAULT_BACKOFF.cap,
    start,
    replay,
    retry,
  }
}
