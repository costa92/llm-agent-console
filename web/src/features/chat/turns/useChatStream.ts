import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { chatStream } from '@/features/chat/api/stream'
import { chatSync } from '@/features/chat/api/client'
import { streamEnvelopeSchema } from '@/features/chat/api/schemas'
import {
  connReducer,
  initialConn,
  type ConnState,
} from '@/features/flow/timeline/connection'
import { turnsReducer, initialTurns, type Turn } from './reducer'

/**
 * The imperative chat stream hook (04-RESEARCH.md Pattern 1 + "Stop without
 * flipping to errored"). It wraps the pure `turnsReducer` + the REUSED
 * connection machine (`connReducer`, imported cross-feature) + the 04-01 chat
 * api layer (`chatStream`/`chatSync`). It is the only stateful, side-effecting
 * unit in the keystone.
 *
 * Mirrors `useRunStream`'s STRUCTURE (abortRef, dispatch-on-frame, terminal→
 * abort, .catch(()=>{}) to swallow the abort rejection, unmount aborts) but over
 * the chat `{kind,answer,error}` envelope with a session-id seam instead of a
 * run-id seam — it is NOT a wrapper around useRunStream.
 *
 * Two error CHANNELS (Pitfall 3):
 * - a non-2xx open (429/400) before the stream goes live, or a non-2xx sync →
 *   a SEND-FAILURE (`onSendError`) — the composer re-enables, the UI toasts.
 *   conn does NOT go 'errored'.
 * - an in-stream `error` frame → an IN-BUBBLE error on the turn + conn 'closed'
 *   (a clean stream end with a failure result).
 *
 * The D-05 Stop contract (Pitfall 4): stop() settles the connection 'closed'
 * BEFORE aborting, so the abort-induced onError/rejection can never flip it to
 * 'errored' (the connection terminal-then-error guard holds it 'closed').
 */

export type UseChatStreamOptions = {
  /** A send/transport failure (non-2xx open or sync) — the caller toasts it. */
  onSendError?: (err: unknown) => void
}

export type UseChatStream = {
  turns: Turn[]
  conn: ConnState
  /** The server-assigned session id once known (CHAT-02), else undefined. */
  sessionId: string | undefined
  /** Open a streamed turn (CHAT-01). */
  send: (message: string) => void
  /** The synchronous one-shot (CHAT-03) — folds into the same bubble. */
  sendSync: (message: string) => Promise<void>
  /** Operator Stop (D-05): keep the partial, conn → closed (never errored). */
  stop: () => void
  /** New session (D-06): clear the transcript + reset the session id. */
  newSession: () => void
}

export function useChatStream(opts: UseChatStreamOptions = {}): UseChatStream {
  const { onSendError } = opts
  const [state, dispatch] = useReducer(turnsReducer, initialTurns)
  const [conn, dispatchConn] = useReducer(connReducer, initialConn)
  const [sessionId, setSessionId] = useState<string | undefined>(undefined)

  const abortRef = useRef<AbortController | null>(null)
  const sessionRef = useRef<string | undefined>(undefined)
  /** True once a terminal frame settled OR the operator stopped — guards a late onError. */
  const endedRef = useRef(false)
  /** True once the stream opened cleanly (event-stream) — distinguishes a live
   *  transport drop (→ errored) from a non-2xx open (→ send-failure). */
  const openedRef = useRef(false)

  /** Abort any in-flight stream and forget the controller. */
  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  /** Fold one SSE frame; close+abort on a terminal frame (Pitfall 6). */
  const onFrame = useCallback(
    (event: string | undefined, data: string) => {
      let raw: unknown
      try {
        raw = JSON.parse(data)
      } catch {
        return // a malformed frame is dropped, never crashes the transcript
      }
      const parsed = streamEnvelopeSchema.safeParse(raw)
      if (!parsed.success) return // loose, but a non-object frame is still dropped
      const env = parsed.data
      // The SSE event name is the kind; fall back to the envelope kind.
      const kind = event ?? env.kind
      dispatch({ type: 'frame', kind, payload: env })
      if (kind === 'done' || kind === 'error') {
        endedRef.current = true
        dispatchConn({ type: 'terminal' })
        abort() // terminal → no leaked fetch
      }
    },
    [abort],
  )

  const send = useCallback(
    (message: string) => {
      abort()
      const ac = new AbortController()
      abortRef.current = ac
      endedRef.current = false
      openedRef.current = false
      dispatch({ type: 'startUser', message })
      dispatchConn({ type: 'reset' })
      dispatchConn({ type: 'start' })

      chatStream(
        message,
        sessionRef.current,
        {
          onSession: (id) => {
            // X-Session-Id is set on the open response BEFORE the first frame on
            // a live event-stream (both chat paths). Its arrival marks a CLEAN
            // open — distinguishing a later transport drop (→ errored) from a
            // non-2xx open with no event-stream body (→ send-failure).
            openedRef.current = true
            sessionRef.current = id
            setSessionId(id)
          },
          onMessage: ({ event, data }) => onFrame(event, data),
          onError: () => {
            // A late onError after a terminal frame / stop is ignored by the
            // connection guard; a live drop → errored; a never-opened failure →
            // send-failure (handled in the .catch below — onError may not carry
            // enough to distinguish, so route via openedRef there).
            if (endedRef.current) return
            if (openedRef.current) dispatchConn({ type: 'transport-error' })
          },
        },
        ac.signal,
      ).catch((err) => {
        // fetch-event-source rejects on abort (incl. our terminal/stop abort) and
        // on a non-2xx open. A clean end / stop already settled the connection.
        if (endedRef.current) return
        if (openedRef.current) {
          // the stream was live then dropped → already errored via onError
          dispatchConn({ type: 'transport-error' })
        } else {
          // never opened cleanly → a send-failure (429/400), the composer re-enables
          onSendError?.(err)
        }
      })
    },
    [abort, onFrame, onSendError],
  )

  const sendSync = useCallback(
    async (message: string) => {
      dispatch({ type: 'startUser', message })
      try {
        const reply = await chatSync(message, sessionRef.current)
        if (reply.session_id) {
          sessionRef.current = reply.session_id
          setSessionId(reply.session_id)
        }
        dispatch({ type: 'syncReply', answer: reply.answer })
      } catch (err) {
        onSendError?.(err)
      }
    },
    [onSendError],
  )

  const stop = useCallback(() => {
    endedRef.current = true
    dispatch({ type: 'stop' }) // partial steps/answer STAY, status='stopped' (D-05)
    dispatchConn({ type: 'terminal' }) // → 'closed' (neutral), NOT transport-error
    abort() // cancels the upstream request; the .catch swallows the rejection
  }, [abort])

  const newSession = useCallback(() => {
    abort()
    endedRef.current = false
    openedRef.current = false
    sessionRef.current = undefined
    setSessionId(undefined)
    dispatch({ type: 'reset' })
    dispatchConn({ type: 'reset' })
  }, [abort])

  // Abort the in-flight stream on unmount (no detached upstream request).
  useEffect(() => () => abortRef.current?.abort(), [])

  return { turns: state.turns, conn, sessionId, send, sendSync, stop, newSession }
}
