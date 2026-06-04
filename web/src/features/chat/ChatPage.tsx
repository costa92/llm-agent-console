import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { ScrollArea } from '@/components/ui/scroll-area'
import { ChatError } from '@/features/chat/api/client'
import { useChatStream } from '@/features/chat/turns/useChatStream'
import type { Turn } from '@/features/chat/turns/reducer'
import { SessionHeader } from './components/SessionHeader'
import { MessageBubble } from './components/MessageBubble'
import { Composer } from './components/Composer'

/**
 * The `/chat` surface (Slice A — D-02/D-03/D-06, CHAT-02/03).
 *
 * Owns `useChatStream` (the 04-01 keystone). Layout per the UI-SPEC single
 * column: a SessionHeader (the server-assigned session id via CopyableId + a
 * direct-fire "New session"), a scroll-area transcript mapping `turns` to
 * MessageBubble (the S6 empty state when there are none), and the Composer.
 *
 * Slice A wires the SYNC send path: Enter/Send → `sendSync(message)`, whose
 * reply folds into ONE assistant bubble (no step trace). The composer is
 * disabled while the request is in flight. A send-failure (the hook's
 * `onSendError`, a thrown ChatError on a non-2xx) → the locked Phase-1 toast
 * `Send failed — {status}: {error}.` and the composer re-enables — NOT an
 * in-bubble red error (the error-channel split). All strings render as TEXT
 * nodes (no dangerouslySetInnerHTML — T-04-04).
 *
 * The Stream|Sync toggle, Stop, and the streamed step-trace arrive in 04-03 (the
 * Composer leaves a marked seam; this page defaults to sync Send).
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
  const [sending, setSending] = useState(false)

  const onSendError = useCallback((err: unknown) => {
    // The send-failure channel: a toast + the composer re-enables. NOT in-bubble.
    toast.error(sendFailureMessage(err))
  }, [])

  const { turns, sessionId, sendSync, newSession } = useChatStream({
    onSendError,
  })

  const handleSend = useCallback(() => {
    const message = draft.trim()
    if (!message || sending) return
    setSending(true)
    setDraft('')
    // sendSync swallows the send-failure into onSendError; it always resolves.
    void sendSync(message).finally(() => setSending(false))
  }, [draft, sending, sendSync])

  const handleNewSession = useCallback(() => {
    newSession()
    setDraft('')
    setSending(false)
  }, [newSession])

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <SessionHeader sessionId={sessionId} onNewSession={handleNewSession} />

      <ScrollArea className="flex-1">
        {turns.length === 0 ? (
          <EmptyConversation />
        ) : (
          <div className="flex flex-col gap-4">
            {turns.map((turn, i) => (
              <TranscriptTurn key={i} turn={turn} />
            ))}
          </div>
        )}
      </ScrollArea>

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        disabled={sending}
        sending={sending}
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
function TranscriptTurn({ turn }: { turn: Turn }) {
  if (turn.role === 'user') {
    return <MessageBubble role="user">{turn.text}</MessageBubble>
  }
  // Slice A: the assistant turn shows the sync answer directly (no trace). A
  // bare/empty answer renders a muted "(no answer returned)" (Pitfall 5).
  const hasAnswer = !!turn.finalAnswer && turn.finalAnswer.length > 0
  return (
    <MessageBubble role="assistant">
      {hasAnswer ? (
        turn.finalAnswer
      ) : (
        <span style={{ color: 'var(--muted-foreground)' }}>
          (no answer returned)
        </span>
      )}
    </MessageBubble>
  )
}
