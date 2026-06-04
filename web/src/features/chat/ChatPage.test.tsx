import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'

import { goldenChatSyncReply } from '@/features/chat/test/golden'

/**
 * Component tests for ChatPage (04-02 Slice A — the SYNC send path).
 *
 * The page owns `useChatStream`; its sync send goes through `chatSync` (a plain
 * fetch in client.ts), which we mock so no live customer-support is needed. We
 * drive the REAL hook + reducer so this is a true end-to-end render of the sync
 * slice (user bubble → one assistant bubble, session capture/display/reuse,
 * New-session reset, the empty state, and the 429 send-failure toast).
 *
 * Pins (04-VALIDATION rows assignable to Slice A):
 * - "sync" (CHAT-03): a sync reply renders into ONE assistant bubble, no trace.
 * - session display + reuse (CHAT-02): the id shows via CopyableId; turn 2 sends
 *   it back in the chatSync body.
 * - "new session" (CHAT-02/D-06): New session clears to the empty state + resets
 *   the id to "no session yet".
 * - "send failed" (CHAT-01/03): a non-2xx (ChatError 429) → toast.error with the
 *   locked copy + the composer re-enables (NOT an in-bubble red error).
 * - empty state (D-06): first mount shows "No messages yet." + the subline.
 */

const chatSyncMock = vi.fn()
vi.mock('@/features/chat/api/client', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, chatSync: (...a: unknown[]) => chatSyncMock(...a) }
})

import { ChatError } from '@/features/chat/api/client'
import { ChatPage } from './ChatPage'

function typeAndSend(message: string) {
  const textarea = screen.getByLabelText('Message the agent')
  fireEvent.change(textarea, { target: { value: message } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

beforeEach(() => {
  chatSyncMock.mockReset()
})

describe('ChatPage — empty state (D-06)', () => {
  it('on first mount shows the empty conversation copy', () => {
    render(<ChatPage />)
    expect(screen.getByText('No messages yet.')).toBeInTheDocument()
    expect(
      screen.getByText('Send a message to start a conversation.'),
    ).toBeInTheDocument()
    // Pre-first-turn the session header shows the muted no-session copy.
    expect(
      screen.getByText('No session yet — send a message to start.'),
    ).toBeInTheDocument()
  })
})

describe('ChatPage — sync send (CHAT-03)', () => {
  it('renders the user message + the reply into a single assistant bubble (no trace)', async () => {
    chatSyncMock.mockResolvedValueOnce(goldenChatSyncReply)
    render(<ChatPage />)

    typeAndSend('where is my order?')

    // User bubble carries the typed message.
    expect(await screen.findByText('where is my order?')).toBeInTheDocument()
    // The sync answer lands in the assistant bubble.
    expect(
      await screen.findByText('Your order ships tomorrow.'),
    ).toBeInTheDocument()

    // Exactly ONE assistant bubble, and no "{N} steps" trace summary.
    const assistant = screen.getAllByText('ASSISTANT')
    expect(assistant).toHaveLength(1)
    expect(screen.queryByText(/steps/i)).not.toBeInTheDocument()
  })

  it('displays the server session id via CopyableId and reuses it on the next turn (CHAT-02)', async () => {
    chatSyncMock
      .mockResolvedValueOnce(goldenChatSyncReply) // turn 1 assigns sess-sync-1
      .mockResolvedValueOnce({ ...goldenChatSyncReply, answer: 'Tomorrow.' })
    render(<ChatPage />)

    typeAndSend('turn one')
    // The header shows the assigned id (CopyableId renders it verbatim).
    expect(await screen.findByText('sess-sync-1')).toBeInTheDocument()

    // Turn 1 sent NO session_id (first turn — server assigns).
    expect(chatSyncMock.mock.calls[0]).toEqual(['turn one', undefined])

    // Turn 2 must echo the captured id back to chatSync.
    typeAndSend('turn two')
    await waitFor(() => expect(chatSyncMock).toHaveBeenCalledTimes(2))
    expect(chatSyncMock.mock.calls[1]).toEqual(['turn two', 'sess-sync-1'])
  })
})

describe('ChatPage — new session (CHAT-02 / D-06)', () => {
  it('clears the transcript to the empty state and resets the id to "no session yet"', async () => {
    chatSyncMock.mockResolvedValueOnce(goldenChatSyncReply)
    render(<ChatPage />)

    typeAndSend('hello')
    expect(await screen.findByText('sess-sync-1')).toBeInTheDocument()
    expect(screen.getByText('Your order ships tomorrow.')).toBeInTheDocument()

    // New session fires directly (no confirm dialog).
    fireEvent.click(screen.getByRole('button', { name: 'New session' }))

    // Transcript clears to the empty state; id resets.
    expect(screen.getByText('No messages yet.')).toBeInTheDocument()
    expect(screen.queryByText('Your order ships tomorrow.')).not.toBeInTheDocument()
    expect(
      screen.getByText('No session yet — send a message to start.'),
    ).toBeInTheDocument()
  })
})

describe('ChatPage — send failed (CHAT-01/03)', () => {
  it('a 429 sync failure toasts the locked copy and re-enables the composer (NOT in-bubble red)', async () => {
    const errorSpy = vi.spyOn(toast, 'error')
    chatSyncMock.mockRejectedValueOnce(
      new ChatError(429, 'rate limit exceeded'),
    )
    render(<ChatPage />)

    typeAndSend('too many')

    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        'Send failed — 429: rate limit exceeded.',
      ),
    )

    // The user bubble still shows; the failure is NOT an in-bubble red error.
    expect(await screen.findByText('too many')).toBeInTheDocument()
    expect(screen.queryByText(/Failed —/)).not.toBeInTheDocument()

    // The composer re-enables: typing again makes Send available.
    const textarea = screen.getByLabelText('Message the agent')
    fireEvent.change(textarea, { target: { value: 'retry' } })
    expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled()
  })
})

describe('ChatPage — bare/empty answer (Pitfall 5)', () => {
  it('renders a muted "(no answer returned)" rather than a blank bubble', async () => {
    chatSyncMock.mockResolvedValueOnce({
      answer: '',
      agent: 'support-bot',
      session_id: 'sess-empty',
    })
    render(<ChatPage />)

    typeAndSend('hi')
    const bubble = (await screen.findAllByText('ASSISTANT'))[0].closest(
      '[data-role="assistant"]',
    ) as HTMLElement
    expect(within(bubble).getByText('(no answer returned)')).toBeInTheDocument()
  })
})
