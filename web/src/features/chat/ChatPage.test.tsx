import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'

import { goldenChatSyncReply, goldenChatSuccess, goldenChatError } from '@/features/chat/test/golden'

/**
 * Component tests for ChatPage (04-02 Slice A SYNC path + 04-03 Slice B STREAM).
 *
 * Two mock surfaces, no live backend:
 * - `chatSync` (the sync one-shot fetch in client.ts) is mocked directly.
 * - `@/lib/sse` `openSseStream` is mocked with the Phase-3 controllable fake
 *   emitter (the hoisted-fake idiom from 04-01) so the streamed path is driven
 *   frame-by-frame (emit / emitOpen / close / fail).
 *
 * We drive the REAL useChatStream + turnsReducer + StepTrace + ConnectionBadge,
 * so this is a true end-to-end render of both slices.
 *
 * Streamed pins (04-03 / 04-VALIDATION):
 * - streamed Send is the DEFAULT; step frames append live as StepTrace rows; the
 *   "Streaming" badge shows; on done → answer + collapsed "{N} steps".
 * - Thinking… placeholder between Send and the first frame (no bare blank).
 * - Stop (D-05): partial stays + muted "Stopped." chip + badge "Closed" (NOT
 *   "Connection lost"); composer re-enables.
 * - in-stream error (D-01): in-bubble red "Failed — {error}." + partial kept,
 *   badge "Closed".
 * - transport drop (D-05): fail() with no terminal → amber "Connection lost." +
 *   muted dropped-line; partial trace stays.
 * - Stream|Sync toggle (D-03): Sync routes to chatSync → one bubble, NO trace.
 * - disabled-while-streaming (D-04): textarea + Send disabled; Stop shown.
 *
 * Sync pins (04-02, kept green): sync-into-one-bubble, session display/reuse,
 * New-session reset, empty state, 429 toast, bare-answer.
 */

const chatSyncMock = vi.fn()
vi.mock('@/features/chat/api/client', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, chatSync: (...a: unknown[]) => chatSyncMock(...a) }
})

// The controllable fake SSE emitter, built inside the hoisted factory so the
// hoisted vi.mock can reference it (the canonical 04-01 idiom).
const fake = await vi.hoisted(async () => {
  const { makeFakeSseStream } = await import('@/test/mocks/fetch-event-source')
  return makeFakeSseStream()
})
vi.mock('@/lib/sse', () => ({ openSseStream: fake.openSseStream }))

import { ChatError } from '@/features/chat/api/client'
import { ChatPage } from './ChatPage'

function type(message: string) {
  const textarea = screen.getByLabelText('Message the agent')
  fireEvent.change(textarea, { target: { value: message } })
}
function send(message: string) {
  type(message)
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}
function sendSync(message: string) {
  // Flip to Sync first, then send.
  fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
  send(message)
}

beforeEach(() => {
  chatSyncMock.mockReset()
  // The fake emitter is module-level (built once in the hoisted factory); clear
  // its accumulated calls between tests so per-test call counts are accurate.
  vi.mocked(fake.openSseStream).mockClear()
})

describe('ChatPage — empty state (D-06)', () => {
  it('on first mount shows the empty conversation copy', () => {
    render(<ChatPage />)
    expect(screen.getByText('No messages yet.')).toBeInTheDocument()
    expect(
      screen.getByText('Send a message to start a conversation.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('No session yet — send a message to start.'),
    ).toBeInTheDocument()
  })
})

describe('ChatPage — streamed send is the default (CHAT-01)', () => {
  it('streams step rows live, shows the Streaming badge, then collapses to "{N} steps" + answer on done', async () => {
    render(<ChatPage />)

    send('where is my order?')
    // User bubble.
    expect(await screen.findByText('where is my order?')).toBeInTheDocument()
    // It went through the STREAM path (not sync).
    expect(fake.openSseStream).toHaveBeenCalledTimes(1)
    expect(chatSyncMock).not.toHaveBeenCalled()

    // Open the stream + emit the two steps.
    await fake.emitOpen({ 'X-Session-Id': 'sess-stream-1' })
    fake.emit(goldenChatSuccess.slice(0, 2)) // two `step` frames

    // Streaming badge + live step rows appear (trace expanded).
    expect(await screen.findByText('Streaming')).toBeInTheDocument()
    expect(
      await screen.findByText('Looking up the order status…'),
    ).toBeInTheDocument()
    expect(screen.getByText('lookup_order(42)')).toBeInTheDocument()
    expect(screen.getByText('Streaming steps…')).toBeInTheDocument()

    // Emit the terminal done frame → final answer + collapsed "{N} steps".
    fake.emit(goldenChatSuccess.slice(2))
    await fake.close()

    expect(
      await screen.findByText('Your order ships tomorrow.'),
    ).toBeInTheDocument()
    expect(await screen.findByText('2 steps')).toBeInTheDocument()
    // Collapsed: the step texts are hidden until re-expanded.
    expect(
      screen.queryByText('Looking up the order status…'),
    ).not.toBeInTheDocument()
    // The badge settles to Closed (clean done).
    expect(await screen.findByText('Closed')).toBeInTheDocument()
  })

  it('shows a Thinking… placeholder between Send and the first frame (no bare blank)', async () => {
    render(<ChatPage />)
    send('hello')
    await fake.emitOpen({ 'X-Session-Id': 'sess-stream-2' })
    // No frame emitted yet → the placeholder shows.
    expect(await screen.findByText('Thinking…')).toBeInTheDocument()
  })
})

describe('ChatPage — Stop (D-05 operator-critical)', () => {
  it('keeps the partial + shows a muted "Stopped." chip, badge "Closed" (NOT lost), composer re-enables', async () => {
    render(<ChatPage />)
    send('long task')
    await fake.emitOpen({ 'X-Session-Id': 'sess-stop-1' })
    fake.emit(goldenChatSuccess.slice(0, 2)) // two partial steps, no terminal

    // Mid-stream: textarea is disabled, Stop is shown.
    expect(screen.getByLabelText('Message the agent')).toBeDisabled()
    const stop = await screen.findByRole('button', { name: 'Stop' })
    expect(await screen.findByText('Streaming')).toBeInTheDocument()

    fireEvent.click(stop)

    // Partial steps stay (re-expand the collapsed trace to confirm).
    expect(await screen.findByText('Stopped.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /2 steps/ }))
    expect(screen.getByText('Looking up the order status…')).toBeInTheDocument()

    // Badge is Closed (neutral) — NOT "Connection lost".
    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.queryByText('Connection lost')).not.toBeInTheDocument()
    expect(screen.queryByText(/Failed —/)).not.toBeInTheDocument()

    // Composer re-enables.
    type('next turn')
    expect(screen.getByLabelText('Message the agent')).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled()
  })
})

describe('ChatPage — in-stream error frame (D-01 stop-on-error)', () => {
  it('renders in-bubble red "Failed — {error}." with the partial trace kept, badge "Closed"', async () => {
    render(<ChatPage />)
    send('break it')
    await fake.emitOpen({ 'X-Session-Id': 'sess-err-1' })
    fake.emit(goldenChatError) // step then error (terminal)
    await fake.close()

    expect(await screen.findByText('Failed — tool call failed.')).toBeInTheDocument()
    // The partial step is kept (re-expand the trace).
    expect(await screen.findByText('1 steps')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /1 steps/ }))
    expect(screen.getByText('Checking inventory…')).toBeInTheDocument()
    // Clean stream end → Closed, not "Connection lost".
    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.queryByText('Connection lost')).not.toBeInTheDocument()
  })
})

describe('ChatPage — transport drop (D-05 / Phase 5 D-03 manual-retry-only)', () => {
  it('shows the amber "Connection lost" badge + a muted dropped line, partial trace stays (D-03 refinement)', async () => {
    // Phase 5 D-03 REFINEMENT (05-03): chat is manual-retry-only on a transport drop.
    // Chat has no de-dup seam — auto re-open would duplicate the whole answer.
    // Both drop seams drive to 'errored' immediately (transport-error → reconnect-give-up).
    // ConnectionBadge renders "Connection lost" (static Unplug amber) — NOT the
    // reconnecting spinner (which is flow-only in the reconnect loop).
    render(<ChatPage />)
    send('drop me')
    await fake.emitOpen({ 'X-Session-Id': 'sess-drop-1' })
    fake.emit(goldenChatSuccess.slice(0, 2)) // partial, no terminal
    await fake.fail() // transport drop — onError + reject, NO terminal frame

    // The ConnectionBadge renders "Connection lost" (errored, D-03 refinement).
    expect(await screen.findByText('Connection lost')).toBeInTheDocument()
    expect(
      screen.getByText('Connection dropped before the reply finished.'),
    ).toBeInTheDocument()
    // The partial trace stays (status is still streaming-shaped; rows visible).
    expect(screen.getByText('Looking up the order status…')).toBeInTheDocument()
    // NOT a red turn error.
    expect(screen.queryByText(/Failed —/)).not.toBeInTheDocument()
  })
})

describe('ChatPage — Stream|Sync toggle (D-03 / CHAT-03)', () => {
  it('Sync routes Send to chatSync → one bubble with NO trace', async () => {
    chatSyncMock.mockResolvedValueOnce(goldenChatSyncReply)
    render(<ChatPage />)

    sendSync('sync please')

    expect(await screen.findByText('sync please')).toBeInTheDocument()
    expect(
      await screen.findByText('Your order ships tomorrow.'),
    ).toBeInTheDocument()
    // The sync path was used; no stream opened.
    expect(chatSyncMock).toHaveBeenCalledTimes(1)
    expect(fake.openSseStream).not.toHaveBeenCalled()
    // ONE assistant bubble, no "{N} steps" trace summary.
    expect(screen.getAllByText('ASSISTANT')).toHaveLength(1)
    expect(screen.queryByText(/steps/i)).not.toBeInTheDocument()
  })
})

describe('ChatPage — sync send still works when toggled (CHAT-02 session reuse)', () => {
  it('displays the server session id via CopyableId and reuses it on the next sync turn', async () => {
    chatSyncMock
      .mockResolvedValueOnce(goldenChatSyncReply)
      .mockResolvedValueOnce({ ...goldenChatSyncReply, answer: 'Tomorrow.' })
    render(<ChatPage />)

    // Switch to Sync once; it stays sync for both turns.
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    send('turn one')
    expect(await screen.findByText('sess-sync-1')).toBeInTheDocument()
    expect(chatSyncMock.mock.calls[0]).toEqual(['turn one', undefined])

    send('turn two')
    await waitFor(() => expect(chatSyncMock).toHaveBeenCalledTimes(2))
    expect(chatSyncMock.mock.calls[1]).toEqual(['turn two', 'sess-sync-1'])
  })
})

describe('ChatPage — new session (CHAT-02 / D-06)', () => {
  it('clears the transcript to the empty state and resets the id (sync turn)', async () => {
    chatSyncMock.mockResolvedValueOnce(goldenChatSyncReply)
    render(<ChatPage />)

    sendSync('hello')
    expect(await screen.findByText('sess-sync-1')).toBeInTheDocument()
    expect(screen.getByText('Your order ships tomorrow.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New session' }))

    expect(screen.getByText('No messages yet.')).toBeInTheDocument()
    expect(screen.queryByText('Your order ships tomorrow.')).not.toBeInTheDocument()
    expect(
      screen.getByText('No session yet — send a message to start.'),
    ).toBeInTheDocument()
  })
})

describe('ChatPage — send failed (sync 429, CHAT-01/03)', () => {
  it('a 429 sync failure toasts the locked copy and re-enables the composer (NOT in-bubble red)', async () => {
    const errorSpy = vi.spyOn(toast, 'error')
    chatSyncMock.mockRejectedValueOnce(new ChatError(429, 'rate limit exceeded'))
    render(<ChatPage />)

    sendSync('too many')

    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        'Send failed — 429: rate limit exceeded.',
      ),
    )
    expect(await screen.findByText('too many')).toBeInTheDocument()
    expect(screen.queryByText(/Failed —/)).not.toBeInTheDocument()

    const textarea = screen.getByLabelText('Message the agent')
    fireEvent.change(textarea, { target: { value: 'retry' } })
    expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled()
  })
})

describe('ChatPage — bare/empty answer (Pitfall 5)', () => {
  it('renders a muted "(no answer returned)" rather than a blank bubble (sync)', async () => {
    chatSyncMock.mockResolvedValueOnce({
      answer: '',
      agent: 'support-bot',
      session_id: 'sess-empty',
    })
    render(<ChatPage />)

    sendSync('hi')
    const bubble = (await screen.findAllByText('ASSISTANT'))[0].closest(
      '[data-role="assistant"]',
    ) as HTMLElement
    expect(within(bubble).getByText('(no answer returned)')).toBeInTheDocument()
  })
})
