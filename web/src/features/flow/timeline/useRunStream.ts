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
 * - on a transport drop before any terminal: conn 'errored'.
 * - retry() (D-09 / IC-6): if a run_id is KNOWN, recover by hydrating GET
 *   /runs/{id}/events as `source:'history'` (the reducer de-dups so nothing
 *   doubles) — NOT a fresh /run/stream POST (that would start a NEW run). If no
 *   run_id is known yet, retry() re-opens runStream (a genuinely new attempt).
 * - replay(runId): open `/replay`, feeding the SAME reducer with source:'history'.
 * - unmount aborts the in-flight stream.
 */

export type StartOpts = {
  /** Invoked once with the live run_id when flowd's X-Run-ID arrives (D-08). */
  onRunId?: (runId: string) => void
}

export type UseRunStream = {
  timeline: Timeline
  conn: ConnState
  /** The live/replayed run_id once known (from X-Run-ID), else undefined. */
  runId: string | undefined
  start: (
    flowId: string,
    inputs: Record<string, string>,
    opts?: StartOpts,
  ) => void
  replay: (runId: string) => void
  retry: () => Promise<void>
}

export function useRunStream(): UseRunStream {
  const [timeline, dispatch] = useReducer(timelineReducer, initialTimeline)
  const [conn, dispatchConn] = useReducer(connReducer, initialConn)
  const [runId, setRunId] = useState<string | undefined>(undefined)

  const abortRef = useRef<AbortController | null>(null)
  const runIdRef = useRef<string | undefined>(undefined)
  /** Remember the last start args so retry() can re-open a never-created run. */
  const lastStartRef = useRef<{
    flowId: string
    inputs: Record<string, string>
    opts?: StartOpts
  } | null>(null)

  /** Abort any in-flight stream and forget the controller. */
  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

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
        dispatchConn({ type: 'terminal' })
        abort() // terminal → no leaked fetch (Pitfall 6)
      }
    },
    [abort],
  )

  const start = useCallback(
    (flowId: string, inputs: Record<string, string>, opts?: StartOpts) => {
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
          onError: () => dispatchConn({ type: 'transport-error' }),
        },
        ac.signal,
      ).catch(() => {
        // fetch-event-source rejects on abort (incl. our own terminal abort) —
        // a transport drop already routed through onError; ignore here.
      })
    },
    [abort, onFrame],
  )

  const replay = useCallback(
    (id: string) => {
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
    [abort, onFrame],
  )

  const retry = useCallback(async () => {
    const knownRunId = runIdRef.current
    if (knownRunId) {
      // D-09 / IC-6: the run was ALREADY created. Recover by hydrating the
      // persisted events as history (the reducer de-dups (kind,node,ordinal)
      // against whatever the live prefix already folded) — NOT a fresh
      // /run/stream POST, which would start a brand-new run.
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
      // A terminal frame in the hydrated history settles the connection closed;
      // otherwise the run may still be in-flight (Phase 5 re-opens the live tail).
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
  }, [start])

  // Abort the in-flight stream on unmount (T-03-06: no detached flowd run).
  useEffect(() => () => abortRef.current?.abort(), [])

  return { timeline, conn, runId, start, replay, retry }
}
