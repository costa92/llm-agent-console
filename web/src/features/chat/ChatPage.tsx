import { useCallback, useState } from 'react'
import { Loader } from 'lucide-react'
import { toast } from 'sonner'

import { ScrollArea } from '@/components/ui/scroll-area'
import { ConnectionBadge } from '@/features/flow/components/ConnectionBadge'
import type { ConnState } from '@/features/flow/timeline/connection'
import { ChatError } from '@/features/chat/api/client'
import { useChatStream } from '@/features/chat/turns/useChatStream'
import type { AssistantTurn, Turn } from '@/features/chat/turns/reducer'
import { SessionHeader } from './components/SessionHeader'
import { MessageBubble } from './components/MessageBubble'
import { Composer, type SendMode } from './components/Composer'
import { StepTrace } from './components/StepTrace'

/**
 * The `/chat` surface (Slice A + Slice B — D-01..D-06, CHAT-01/02/03).
 *
 * Owns `useChatStream` (the 04-01 keystone) + the local composer `draft`, the
 * send `mode` (Stream | Sync, D-03), and a `sending` flag for the sync in-flight
 * (the hook's `conn` is stream-only).
 *
 * Send routing (CHAT-03 / D-03): mode==='stream' (the DEFAULT) → `send` (the
 * streamed path → live StepTrace + ConnectionBadge); mode==='sync' → `sendSync`
 * (one-shot, folds into the SAME assistant bubble with NO trace). Both render
 * into one assistant bubble.
 *
 * The active assistant turn renders (IC-2/IC-3/IC-5, D-01/D-05):
 * - the collapsible `StepTrace` (expanded + live tail while streaming; collapsed
 *   "{N} steps" once settled) + a `ConnectionBadge` (Streaming / Closed /
 *   Connection lost) in the bubble header;
 * - a muted "Thinking…" placeholder when streaming with zero steps (no blank);
 * - the final answer (text node) on done ("(no answer returned)" if bare,
 *   Pitfall 5);
 * - red in-bubble "Failed — {error}." on an `error` frame (partial trace kept,
 *   no retry, D-01);
 * - a muted "Stopped." chip when the operator Stopped (D-05, partial kept);
 * - an amber "Connection lost." + muted dropped-line when the transport dropped
 *   (conn==='errored', D-05).
 *
 * The D-05 three-signal distinction (muted Stopped / red Failed / amber
 * Connection lost) is the operator-critical contract: Stop lands `closed`
 * (neutral) via the 04-01 connection machine — never `errored`.
 *
 * The send-failure channel (the hook's `onSendError`, a thrown ChatError on a
 * non-2xx) → the locked Phase-1 toast + the composer re-enables — NOT an
 * in-bubble red error. All strings render as TEXT nodes (no
 * dangerouslySetInnerHTML — T-04-07).
 */

/** Format the locked send-failure toast copy from a thrown error. */
function sendFailureMessage(err: unknown): string {
  if (err instanceof ChatError) {
    return `Send failed — ${err.status}: ${err.message}.`
  }
  const message = err instanceof Error ? err.message : 'unknown error'
  return `Send failed — ${message}.`
}

export function ChatPage() {
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<SendMode>('stream')
  const [sending, setSending] = useState(false)

  const onSendError = useCallback((err: unknown) => {
    // The send-failure channel: a toast + the composer re-enables. NOT in-bubble.
    toast.error(sendFailureMessage(err))
  }, [])

  const { turns, conn, sessionId, send, sendSync, stop, newSession } =
    useChatStream({ onSendError })

  const streaming = conn === 'streaming'

  const handleSend = useCallback(() => {
    const message = draft.trim()
    if (!message || sending || streaming) return
    setDraft('')
    if (mode === 'stream') {
      // The streamed default: the hook drives conn (streaming → closed/errored).
      send(message)
      return
    }
    // The sync one-shot: a page-local `sending` flag is the in-flight signal.
    setSending(true)
    void sendSync(message).finally(() => setSending(false))
  }, [draft, sending, streaming, mode, send, sendSync])

  const handleNewSession = useCallback(() => {
    newSession()
    setDraft('')
    setSending(false)
  }, [newSession])

  // The composer is disabled while a turn is in flight (stream OR sync).
  const inFlight = streaming || sending
  const lastIndex = turns.length - 1

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <SessionHeader sessionId={sessionId} onNewSession={handleNewSession} />

      <ScrollArea className="flex-1">
        {turns.length === 0 ? (
          <EmptyConversation />
        ) : (
          <div className="flex flex-col gap-4">
            {turns.map((turn, i) => (
              <TranscriptTurn
                key={i}
                turn={turn}
                // The connection badge/markers attach ONLY to the active (last)
                // assistant turn — earlier turns are settled history.
                conn={i === lastIndex ? conn : 'idle'}
                isActive={i === lastIndex}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        mode={mode}
        onModeChange={setMode}
        streaming={streaming}
        disabled={inFlight}
        onStop={stop}
      />
    </div>
  )
}

/** The S6 empty conversation state (D-06). */
function EmptyConversation() {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <p
        className="text-xl font-semibold"
        style={{ color: 'var(--foreground)' }}
      >
        No messages yet.
      </p>
      <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
        Send a message to start a conversation.
      </p>
    </div>
  )
}

/** Render one turn into its bubble. */
function TranscriptTurn({
  turn,
  conn,
  isActive,
}: {
  turn: Turn
  conn: ConnState
  isActive: boolean
}) {
  if (turn.role === 'user') {
    return <MessageBubble role="user">{turn.text}</MessageBubble>
  }
  return (
    <AssistantBubble turn={turn} conn={conn} isActive={isActive} />
  )
}

/** The assistant turn surface: trace + indicators + the D-05 markers (D-01/D-05). */
function AssistantBubble({
  turn,
  conn,
  isActive,
}: {
  turn: AssistantTurn
  conn: ConnState
  isActive: boolean
}) {
  const streaming = turn.status === 'streaming'
  const hasAnswer = !!turn.finalAnswer && turn.finalAnswer.length > 0
  return (
    <MessageBubble role="assistant" aside={<ConnectionBadge conn={conn} />}>
      {/* The collapsible step trace (expanded+live while streaming, else
          collapsed "{N} steps"). Empty steps → renders nothing. */}
      <StepTrace steps={turn.steps} status={turn.status} />

      {/* Thinking… placeholder (sent, streaming, no step yet — never blank). */}
      {streaming && turn.steps.length === 0 && (
        <div
          className="mt-2 flex items-center gap-2 text-sm"
          style={{ color: 'var(--muted-foreground)' }}
        >
          <Loader className="size-4 animate-spin" aria-hidden />
          Thinking…
        </div>
      )}

      {/* The final answer (done) — a TEXT node; muted "(no answer returned)"
          for a bare/empty answer (Pitfall 5). */}
      {turn.status === 'done' && (
        <div className="mt-2">
          {hasAnswer ? (
            turn.finalAnswer
          ) : (
            <span style={{ color: 'var(--muted-foreground)' }}>
              (no answer returned)
            </span>
          )}
        </div>
      )}

      {/* In-stream error frame (D-01 stop-on-error): in-bubble RED, mono; the
          partial trace above STAYS; no retry affordance (re-ask is a fresh Send). */}
      {turn.status === 'error' && (
        <p
          className="mono mt-2 text-sm"
          style={{ color: 'var(--status-down)' }}
          data-slot="turn-error"
        >
          Failed — {turn.error}.
        </p>
      )}

      {/* Stop marker (D-05): muted chip, partial stays. NOT red — operator-benign. */}
      {turn.status === 'stopped' && (
        <div className="mt-2 flex flex-col gap-0.5">
          <span
            className="w-fit rounded-md px-2 py-0.5 text-xs"
            style={{
              color: 'var(--muted-foreground)',
              background:
                'color-mix(in oklch, var(--status-unknown) 12%, transparent)',
            }}
            data-slot="stopped-chip"
          >
            Stopped.
          </span>
          <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
            Stopped before the agent finished.
          </span>
        </div>
      )}

      {/* 05-04 IC-4: transient reconnecting subline (for symmetry with flow).
          In practice chat is manual-retry-only (D-03 refinement) so
          conn==='reconnecting' is never observed — but wire it for
          completeness and in case a brief reconnecting tick arrives.
          TEXT node — T-V5. */}
      {isActive && conn === 'reconnecting' && (
        <p
          className="mt-2 text-xs"
          style={{ color: 'var(--muted-foreground)' }}
          data-slot="reconnecting-subline"
        >
          Connection dropped — reconnecting…
        </p>
      )}

      {/* Transport drop (D-05): amber line under the partial trace; the amber
          ConnectionBadge "Connection lost." is already in the header. */}
      {isActive && conn === 'errored' && (
        <p
          className="mt-2 text-xs"
          style={{ color: 'var(--status-degraded)' }}
          data-slot="conn-lost"
        >
          Connection dropped before the reply finished.
        </p>
      )}
    </MessageBubble>
  )
}
