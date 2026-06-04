import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { makeFakeSseStream } from '@/test/mocks/fetch-event-source'
import {
  goldenChatSuccess,
  goldenChatError,
  goldenChatSyncReply,
} from '@/features/chat/test/golden'

/**
 * Unit tests for the imperative useChatStream hook (04-01 Task 3).
 *
 * The hook drives SSE through `openSseStream` (web/src/lib/sse.ts), so we mock
 * THAT wrapper with the Phase-3 controllable fake — no live customer-support.
 * `chatSync` (a plain fetch in client.ts) is mocked separately.
 *
 * Pins: CHAT-01 stream lifecycle, CHAT-02 X-Session-Id capture-on-open +
 * body-only reuse on turn 2, the D-05 Stop→closed (NOT errored) contract
 * (Pitfall 4 — the most important visual contract), transport-drop→errored,
 * 429 send-failure surfaced as a transport failure (not in-bubble), newSession
 * clears + resets the id, and the sync one-bubble fold (CHAT-03).
 */

const fake = makeFakeSseStream()
vi.mock('@/lib/sse', () => ({ openSseStream: fake.openSseStream }))

const chatSyncMock = vi.fn()
vi.mock('@/features/chat/api/client', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, chatSync: (...a: unknown[]) => chatSyncMock(...a) }
})

import { useChatStream } from './useChatStream'

/** The active (last) assistant turn helper. */
function lastAssistant(turns: ReturnType<typeof useChatStream>['turns']) {
  const t = turns[turns.length - 1]
  if (t.role !== 'assistant') throw new Error('last turn is not assistant')
  return t
}

beforeEach(() => {
  fake.openSseStream.mock.calls.length &&
    fake.openSseStream.mock.calls.splice(0)
  chatSyncMock.mockReset()
})

describe('useChatStream — stream lifecycle (CHAT-01)', () => {
  it('send → streaming; steps append; done → finalAnswer + closed', async () => {
    const { result } = renderHook(() => useChatStream())

    act(() => result.current.send('hi'))
    expect(result.current.conn).toBe('streaming')

    await act(async () => {
      await fake.emitOpen({ 'X-Session-Id': 'sess-1' })
    })
    await waitFor(() => expect(result.current.sessionId).toBe('sess-1'))

    act(() => fake.emit(goldenChatSuccess.slice(0, 2)))
    await waitFor(() =>
      expect(lastAssistant(result.current.turns).steps).toHaveLength(2),
    )

    act(() => fake.emit(goldenChatSuccess[2]))
    await waitFor(() => expect(result.current.conn).toBe('closed'))
    const asst = lastAssistant(result.current.turns)
    expect(asst.status).toBe('done')
    expect(asst.finalAnswer).toBe('Your order ships tomorrow.')
  })
})

describe('useChatStream — session reuse in the request BODY, never a header (CHAT-02)', () => {
  it('turn 2 sends session_id in the body, with no X-Session-Id request header', async () => {
    const { result } = renderHook(() => useChatStream())

    act(() => result.current.send('first'))
    await act(async () => {
      await fake.emitOpen({ 'X-Session-Id': 'sess-1' })
    })
    await waitFor(() => expect(result.current.sessionId).toBe('sess-1'))
    act(() => fake.emit(goldenChatSuccess[2])) // done → closed

    await waitFor(() => expect(result.current.conn).toBe('closed'))

    act(() => result.current.send('again'))
    const cap = fake.captured()
    expect(JSON.parse(cap!.body!)).toEqual({
      message: 'again',
      session_id: 'sess-1',
    })
    // session_id is NOT a request header — only the body carries it.
    expect(cap!.headers?.['X-Session-Id']).toBeUndefined()
  })
})

describe('useChatStream — Stop keeps the partial + conn closed, NEVER errored (D-05 / Pitfall 4)', () => {
  it('stop mid-stream → status stopped, partials stay, conn closed even after a late abort rejection', async () => {
    const { result } = renderHook(() => useChatStream())

    act(() => result.current.send('hi'))
    await act(async () => {
      await fake.emitOpen({ 'X-Session-Id': 'sess-1' })
    })
    act(() => fake.emit(goldenChatSuccess.slice(0, 2))) // two partial steps

    act(() => result.current.stop())

    await waitFor(() => expect(result.current.conn).toBe('closed'))
    const asst = lastAssistant(result.current.turns)
    expect(asst.status).toBe('stopped')
    expect(asst.steps).toHaveLength(2)

    // A late transport failure AFTER stop must NOT flip closed → errored.
    await act(async () => {
      await fake.fail(new Error('aborted'))
    })
    expect(result.current.conn).toBe('closed')
  })
})

describe('useChatStream — transport drop with no Stop → errored (amber)', () => {
  it('fail() before any terminal frame flips conn to errored', async () => {
    const { result } = renderHook(() => useChatStream())

    act(() => result.current.send('hi'))
    await act(async () => {
      await fake.emitOpen({ 'X-Session-Id': 'sess-1' })
    })
    await act(async () => {
      await fake.fail(new Error('transport drop'))
    })
    await waitFor(() => expect(result.current.conn).toBe('errored'))
  })
})

describe('useChatStream — in-stream error frame → in-bubble error, conn closed (D-01)', () => {
  it('an error frame sets the turn error and closes the connection (not a toast)', async () => {
    const onSendError = vi.fn()
    const { result } = renderHook(() => useChatStream({ onSendError }))

    act(() => result.current.send('hi'))
    await act(async () => {
      await fake.emitOpen({ 'X-Session-Id': 'sess-1' })
    })
    act(() => fake.emit(goldenChatError)) // step → error

    await waitFor(() => expect(result.current.conn).toBe('closed'))
    const asst = lastAssistant(result.current.turns)
    expect(asst.status).toBe('error')
    expect(asst.error).toBe('tool call failed')
    expect(onSendError).not.toHaveBeenCalled() // NOT a send-failure
  })
})

describe('useChatStream — non-2xx open is a send-failure, not an in-bubble error (CHAT-01/03)', () => {
  it('a non-event-stream open throws → onSendError fires, conn not errored', async () => {
    const onSendError = vi.fn()
    const { result } = renderHook(() => useChatStream({ onSendError }))

    act(() => result.current.send('hi'))
    // emitOpen with a JSON content-type → openSseStream open-validation throws.
    await act(async () => {
      await fake.emitOpen({ 'Content-Type': 'application/json' })
      await fake.fail(new Error('open validation failed'))
    })

    await waitFor(() => expect(onSendError).toHaveBeenCalled())
    const asst = lastAssistant(result.current.turns)
    // the turn is NOT marked in-bubble error (no error frame arrived)
    expect(asst.error).toBeUndefined()
  })
})

describe('useChatStream — newSession clears turns + resets the id (D-06)', () => {
  it('newSession empties the transcript and resets sessionId to undefined', async () => {
    const { result } = renderHook(() => useChatStream())

    act(() => result.current.send('hi'))
    await act(async () => {
      await fake.emitOpen({ 'X-Session-Id': 'sess-1' })
    })
    act(() => fake.emit(goldenChatSuccess[2]))
    await waitFor(() => expect(result.current.sessionId).toBe('sess-1'))

    act(() => result.current.newSession())
    expect(result.current.turns).toEqual([])
    expect(result.current.sessionId).toBeUndefined()
  })
})

describe('useChatStream — sendSync folds into one assistant bubble, captures session_id (CHAT-03)', () => {
  it('sync reply sets finalAnswer with no trace and stores the body session_id', async () => {
    chatSyncMock.mockResolvedValue(goldenChatSyncReply)
    const { result } = renderHook(() => useChatStream())

    await act(async () => {
      await result.current.sendSync('hi')
    })

    const asst = lastAssistant(result.current.turns)
    expect(asst.status).toBe('done')
    expect(asst.finalAnswer).toBe('Your order ships tomorrow.')
    expect(asst.steps).toEqual([])
    expect(result.current.sessionId).toBe('sess-sync-1')
  })

  it('a non-2xx sync (ChatError) surfaces via onSendError, not an in-bubble error', async () => {
    const onSendError = vi.fn()
    chatSyncMock.mockRejectedValue(new Error('429 rate limit'))
    const { result } = renderHook(() => useChatStream({ onSendError }))

    await act(async () => {
      await result.current.sendSync('hi')
    })
    expect(onSendError).toHaveBeenCalled()
  })
})

describe('useChatStream — unmount aborts the in-flight stream', () => {
  it('aborts the AbortController on unmount', () => {
    const { result, unmount } = renderHook(() => useChatStream())
    act(() => result.current.send('hi'))
    // openSseStream is called with the AbortSignal in its opts — read it back.
    const opts = fake.openSseStream.mock.calls.at(-1)?.[0] as {
      signal?: AbortSignal
    }
    expect(opts.signal?.aborted).toBe(false)
    unmount()
    expect(opts.signal?.aborted).toBe(true)
  })
})
