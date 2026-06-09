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
 *
 * D-03 REFINEMENT (05-03 Plan 03 — resolves Open-Question #1): Chat is
 * MANUAL-RETRY-ONLY on a transport drop. Unlike flow (which de-dups via
 * (kind,node,ordinal)), chat has NO de-dup/replay seam (Phase-4 contract) —
 * an auto re-open would re-stream the entire answer, producing a duplicate.
 * Therefore BOTH live-drop seams (onError and .catch openedRef-true) dispatch
 * transport-error THEN reconnect-give-up immediately, driving the machine
 * straight to 'errored' without looping through 'reconnecting'.
 * The operator must hit Retry to re-open the stream.
 * This REFINES CONTEXT D-03's "chat re-opens the stream" — the research
 * revealed the duplication problem, so flow auto-reconnects (de-dups) while
 * chat is manual-retry-only; both still stop on terminal, both reach 'errored'
 * on a drop/cap.
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
  /**
   * Manual operator retry (D-03 refinement, 05-03): re-opens the stream after
   * a transport drop landed 'errored'. This is operator-driven only — chat does
   * NOT auto-reconnect (no de-dup seam). A fresh chatStream call is made with
   * the last message; the session is preserved so the agent can resume context.
   */
  retry: () => void
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
  /** The last message sent, for retry() re-open. */
  const lastMessageRef = useRef<string | undefined>(undefined)

  /**
   * "Context" ref for stable captures in async callbacks — holds the latest
   * onSendError callback. Updated via useEffect so callbacks are never stale.
   */
  const onSendErrorRef = useRef(onSendError)
  useEffect(() => { onSendErrorRef.current = onSendError }, [onSendError])

  /** Abort any in-flight stream and forget the controller. */
  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  /**
   * D-03 refinement (05-03): chat is manual-retry-only. Both live-drop seams
   * must reach 'errored' without looping through 'reconnecting'. This helper
   * dispatches transport-error THEN reconnect-give-up in one synchronous step
   * so the machine goes:
   *   'streaming' → transport-error → 'reconnecting' → reconnect-give-up → 'errored'
   * Both dispatches are synchronous — React batches them into a single render so
   * 'reconnecting' is never observed by the UI.
   * Calling this from BOTH the onError AND the .catch openedRef-true branch
   * guarantees that neither seam can strand chat in 'reconnecting' (Pitfall 1).
   */
  const handleChatDrop = useCallback(() => {
    dispatchConn({ type: 'transport-error' })  // → 'reconnecting'
    dispatchConn({ type: 'reconnect-give-up' }) // → 'errored' (immediate, batched)
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

  /**
   * Core stream open — shared by send() and retry(). Captures the message in
   * lastMessageRef so retry() can re-use it.
   */
  const openStream = useCallback(
    (message: string) => {
      abort()
      const ac = new AbortController()
      abortRef.current = ac
      endedRef.current = false
      openedRef.current = false
      lastMessageRef.current = message
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
            // (1) onError seam: live drop (openedRef true) → errored immediately.
            // Late onError after terminal/stop is ignored by the connection guard.
            if (endedRef.current) return
            if (openedRef.current) {
              // D-03 refinement: manual-retry-only → drive to errored immediately.
              handleChatDrop()
            }
            // Never-opened failure handled in the .catch below.
          },
        },
        ac.signal,
      ).catch((err) => {
        // fetch-event-source rejects on abort (incl. our terminal/stop abort) and
        // on a non-2xx open. A clean end / stop already settled the connection.
        if (endedRef.current) return
        if (openedRef.current) {
          // (2) .catch openedRef-true seam: stream was live then dropped.
          // D-03 refinement: manual-retry-only → drive to errored immediately.
          // Both seams call handleChatDrop() which is idempotent on an already-
          // errored machine (reconnect-give-up from 'errored' is a no-op).
          handleChatDrop()
        } else {
          // never opened cleanly → a send-failure (429/400), the composer re-enables
          onSendErrorRef.current?.(err)
        }
      })
    },
    [abort, handleChatDrop, onFrame],
  )

  const send = useCallback(
    (message: string) => {
      openStream(message)
    },
    [openStream],
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
        onSendErrorRef.current?.(err)
      }
    },
    [],
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
    lastMessageRef.current = undefined
    setSessionId(undefined)
    dispatch({ type: 'reset' })
    dispatchConn({ type: 'reset' })
  }, [abort])

  /**
   * Manual retry (D-03 refinement, 05-03): re-opens the stream after a
   * transport drop. Operator-driven only — NOT auto. The transcript is NOT
   * reset (partial turns stay visible). The session is preserved so the
   * agent can resume context if the upstream supports it.
   */
  const retry = useCallback(() => {
    const lastMessage = lastMessageRef.current
    if (!lastMessage) return
    openStream(lastMessage)
  }, [openStream])

  // Abort the in-flight stream on unmount (no detached upstream request).
  useEffect(() => () => abortRef.current?.abort(), [])

  return { turns: state.turns, conn, sessionId, send, sendSync, stop, newSession, retry }
}
