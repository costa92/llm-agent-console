import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { goldenChatSuccess, goldenChatError } from '@/features/chat/test/golden'

/**
 * Reconnect-overlay tests for ChatPage (05-04 IC-4 / D-04).
 *
 * These tests validate the four transport/result signal distinctions (IC-4):
 *   green Streaming · amber-spinning Reconnecting (n/N)… · amber-static
 *   Connection lost · red in-content Failed — {error}.
 *
 * CHAT-SPECIFIC NOTE (D-03 refinement, 05-03):
 * Chat is MANUAL-RETRY-ONLY on a transport drop. Unlike flow (which uses a
 * capped-backoff auto-reconnect loop with de-dup), chat has no de-dup seam —
 * an auto re-open would duplicate the reply. Therefore useChatStream dispatches
 * transport-error + reconnect-give-up ATOMICALLY from both drop seams, so
 * conn === 'reconnecting' is never observed in the chat UI.
 *
 * The reconnecting subline (added for symmetry in 05-04) exists in AssistantBubble
 * but will not render under normal chat usage. The tests below verify what IS
 * observable: the drop → 'errored' path with its amber "Connection lost" badge
 * and the muted dropped line, while confirming the partial trace is kept and the
 * red in-content Failed signal stays distinct.
 */

const chatSyncMock = vi.fn()
vi.mock('@/features/chat/api/client', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, chatSync: (...a: unknown[]) => chatSyncMock(...a) }
})

const fake = await vi.hoisted(async () => {
  const { makeFakeSseStream } = await import('@/test/mocks/fetch-event-source')
  return makeFakeSseStream()
})
vi.mock('@/lib/sse', () => ({ openSseStream: fake.openSseStream }))

import { ChatPage } from './ChatPage'

function send(message: string) {
  fireEvent.change(screen.getByLabelText('Message the agent'), {
    target: { value: message },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

beforeEach(() => {
  chatSyncMock.mockReset()
  vi.mocked(fake.openSseStream).mockClear()
})

describe('ChatPage — reconnecting-overlay: transport drop → errored (IC-4, D-03 refinement)', () => {
  it('transport drop: partial trace STAYS visible + amber "Connection lost" badge + muted dropped line', async () => {
    // D-03 refinement: chat goes drop → 'errored' directly (no 'reconnecting' tick).
    // This drives the same result as cap exhaustion on flow: amber static badge.
    render(<ChatPage />)
    send('help')
    await fake.emitOpen({ 'X-Session-Id': 'sess-rc-1' })
    fake.emit(goldenChatSuccess.slice(0, 2)) // two partial steps, no terminal
    await fake.fail() // transport drop, no terminal

    // PARTIAL TRACE STAYS visible (partial content over the drop).
    expect(
      await screen.findByText('Looking up the order status…'),
    ).toBeInTheDocument()
    expect(screen.getByText('lookup_order(42)')).toBeInTheDocument()

    // AMBER badge: "Connection lost" (static, no spinner — errored, not reconnecting).
    expect(screen.getByText('Connection lost')).toBeInTheDocument()
    // The badge carries data-conn="errored" (not "reconnecting").
    const badge = document.querySelector('[data-conn]')
    expect(badge?.getAttribute('data-conn')).toBe('errored')

    // MUTED DROPPED LINE beneath the partial trace.
    expect(
      screen.getByText('Connection dropped before the reply finished.'),
    ).toBeInTheDocument()
  })

  it('the four signals stay mutually distinct: Streaming / Connection lost / Failed are never conflated', async () => {
    render(<ChatPage />)
    send('distinct signals')
    await fake.emitOpen({ 'X-Session-Id': 'sess-rc-2' })
    fake.emit(goldenChatSuccess.slice(0, 2)) // partial — streaming

    // SIGNAL 1: green Streaming badge (amber NOT present).
    expect(await screen.findByText('Streaming')).toBeInTheDocument()
    expect(screen.queryByText('Connection lost')).not.toBeInTheDocument()
    expect(screen.queryByText(/Failed —/)).not.toBeInTheDocument()

    // Now drop the transport.
    await fake.fail()

    // SIGNAL 3: amber-static "Connection lost" (Streaming now gone).
    expect(await screen.findByText('Connection lost')).toBeInTheDocument()
    expect(screen.queryByText('Streaming')).not.toBeInTheDocument()
    // RED in-content Failed is NOT present — a transport drop is not a content error.
    expect(screen.queryByText(/Failed —/)).not.toBeInTheDocument()
  })

  it('in-content error frame (red Failed) is separate from amber transport drop', async () => {
    render(<ChatPage />)
    send('break it')
    await fake.emitOpen({ 'X-Session-Id': 'sess-rc-3' })
    fake.emit(goldenChatError) // step then error (terminal)
    await fake.close()

    // SIGNAL 4: red in-content Failed (turn genuinely failed — not a transport drop).
    expect(
      await screen.findByText('Failed — tool call failed.'),
    ).toBeInTheDocument()
    // "Connection lost" is NOT present — an in-content error frame does NOT
    // trigger the transport-drop amber path.
    expect(screen.queryByText('Connection lost')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Connection dropped before the reply finished.'),
    ).not.toBeInTheDocument()
    // The badge shows "Closed" (clean stream end with a failure result, D-01).
    expect(screen.getByText('Closed')).toBeInTheDocument()
  })

  it('Streaming badge is green (data-conn="streaming"), not amber', async () => {
    render(<ChatPage />)
    send('stream check')
    await fake.emitOpen({ 'X-Session-Id': 'sess-rc-4' })
    fake.emit(goldenChatSuccess.slice(0, 1)) // first step

    expect(await screen.findByText('Streaming')).toBeInTheDocument()
    const badge = document.querySelector('[data-conn]')
    expect(badge?.getAttribute('data-conn')).toBe('streaming')
    // NOT amber (Connection lost).
    expect(screen.queryByText('Connection lost')).not.toBeInTheDocument()
  })
})
