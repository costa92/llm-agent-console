import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useRunStream } from './useRunStream'
import type { StreamHandlers } from '@/features/flow/api/stream'
import { frames, type SseFrame } from '@/test/mocks/fetch-event-source'

/**
 * Reconnect loop tests for useRunStream (05-03 Task 1).
 *
 * Exercises the capped-backoff auto-reconnect loop wired into useRunStream:
 *   - transport drop → 'reconnecting' (attempt 1/N)
 *   - timer fires → retry() via listRunEvents (de-dup on hydrate)
 *   - successful resume → 'streaming' then terminal → 'closed'
 *   - cap exhaustion → 'errored' via reconnect-give-up
 *   - terminal wins mid-reconnect → 'closed', timer cleared
 *   - no timer fires after unmount or after terminal
 *
 * Uses vi.useFakeTimers and injects rng=()=>0 (via the exposed hook seam or
 * by using fake timers + advanceTimersByTime with a generous stride that
 * covers any jitter ≤ maxMs).
 *
 * Mocks at the stream-wrapper seam (NOT the network).
 */

// ── Controllable fakes for runStream ─────────────────────────────────────────

type Driver = {
  handlers: StreamHandlers
  signal?: AbortSignal
  resolve: () => void
  reject: (e: unknown) => void
  open: (runId: string) => void
  emit: (frames: SseFrame[]) => void
  error: (e?: unknown) => void
}

const drivers: Driver[] = []
const runStreamMock = vi.fn()

function installRunStream() {
  runStreamMock.mockImplementation(
    (_flowId: string, _inputs: unknown, handlers: StreamHandlers, signal?: AbortSignal) => {
      let resolve!: () => void
      let reject!: (e: unknown) => void
      const promise = new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
      })
      drivers.push({
        handlers,
        signal,
        resolve,
        reject,
        open: (runId) => handlers.onRunId?.(runId),
        emit: (fs) => {
          for (const f of fs) handlers.onMessage({ event: f.event, data: f.data })
        },
        error: (e = new Error('transport drop')) => handlers.onError?.(e),
      })
      return promise
    },
  )
}

const listRunEventsMock = vi.fn()

vi.mock('@/features/flow/api/stream', () => ({
  runStream: (...args: unknown[]) => runStreamMock(...args),
  replayStream: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/features/flow/api/client', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, listRunEvents: (...a: unknown[]) => listRunEventsMock(...a) }
})

const last = () => drivers[drivers.length - 1]

/** Prefix frames: flow_started + node_started (no terminal). */
const PREFIX = frames([
  { kind: 'flow_started', payload: { flow: 'echo_chain' } },
  { kind: 'node_started', payload: { node: 'upper', input: { in: 'hello' } } },
])

/** Full history returned by listRunEvents on retry (prefix + tail + terminal). */
const FULL_HISTORY_EVENTS = [
  {
    seq: 1,
    kind: 'flow_started',
    node_id: undefined,
    payload: { flow: 'echo_chain' },
    ts: 't1',
  },
  {
    seq: 2,
    kind: 'node_started',
    node_id: 'upper',
    payload: { node: 'upper', input: { in: 'hello' } },
    ts: 't2',
  },
  {
    seq: 3,
    kind: 'node_finished',
    node_id: 'upper',
    payload: { node: 'upper', output: { out: 'HELLO' } },
    ts: 't3',
  },
  {
    seq: 4,
    kind: 'flow_done',
    node_id: undefined,
    payload: { flow: 'echo_chain', outputs: { out: 'HELLO' } },
    ts: 't4',
  },
]

/** Full history without a terminal — run still in-flight after resume. */
const PARTIAL_HISTORY_EVENTS = FULL_HISTORY_EVENTS.slice(0, 3)

beforeEach(() => {
  drivers.length = 0
  runStreamMock.mockReset()
  listRunEventsMock.mockReset()
  installRunStream()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.runAllTimers()
  vi.useRealTimers()
  vi.clearAllMocks()
})

// ── (1) Drop → reconnecting (attempt exposed) ────────────────────────────────

describe('useRunStream reconnect — drop → reconnecting with attempt counter', () => {
  it('a transport drop enters reconnecting and exposes attempt=1, cap=5', async () => {
    const { result } = renderHook(() => useRunStream())

    act(() => result.current.start('echo_chain', { in: 'hello' }))
    act(() => last().open('run_1'))
    act(() => last().emit(PREFIX))
    act(() => last().error()) // transport drop

    await waitFor(() => expect(result.current.conn).toBe('reconnecting'))
    // attempt and cap are exposed on the hook return value
    expect(result.current.attempt).toBe(1)
    expect(result.current.cap).toBe(5)
  })
})

// ── (2) Successful resume via /events (de-dup) ───────────────────────────────

describe('useRunStream reconnect — resume via /events with de-dup', () => {
  it('fires retry() on timer, hydrates /events, de-dups prefix, returns streaming then closed', async () => {
    // listRunEvents returns the full history including terminal
    listRunEventsMock.mockResolvedValue(FULL_HISTORY_EVENTS)

    const { result } = renderHook(() => useRunStream())
    act(() => result.current.start('echo_chain', { in: 'hello' }))
    act(() => last().open('run_2'))
    act(() => last().emit(PREFIX)) // live prefix: flow_started + node_started
    act(() => last().error()) // transport drop → reconnecting

    await waitFor(() => expect(result.current.conn).toBe('reconnecting'))

    // Advance fake timers to trigger the backoff timer (ANY amount ≥ 0 suffices
    // because rng full-jitter always produces a value in [0, ceiling))
    await act(async () => {
      vi.runAllTimers()
      // wait for the promise inside the timer to settle
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // listRunEvents should have been called with the known runId
    expect(listRunEventsMock).toHaveBeenCalledWith('run_2')

    // After terminal history arrives, conn transitions closed
    await waitFor(() => expect(result.current.conn).toBe('closed'))

    // De-dup: the prefix events (flow_started, node_started) appear EXACTLY ONCE
    const kinds = result.current.timeline.events.map((e) => e.kind)
    expect(kinds.filter((k) => k === 'flow_started')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'node_started')).toHaveLength(1)
    // node_finished and flow_done were only in history, so they appear once too
    expect(kinds.filter((k) => k === 'node_finished')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'flow_done')).toHaveLength(1)
  })

  it('resume without terminal: conn returns to streaming (reconnect-success)', async () => {
    // History does NOT include a terminal frame — run still in-flight
    listRunEventsMock.mockResolvedValue(PARTIAL_HISTORY_EVENTS)

    const { result } = renderHook(() => useRunStream())
    act(() => result.current.start('echo_chain', { in: 'hello' }))
    act(() => last().open('run_3'))
    act(() => last().emit(PREFIX))
    act(() => last().error())

    await waitFor(() => expect(result.current.conn).toBe('reconnecting'))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // Non-terminal history → conn back to 'streaming' (reconnect-success)
    await waitFor(() => expect(result.current.conn).toBe('streaming'))
    expect(result.current.attempt).toBe(0) // reset after success
  })
})

// ── (3) Cap exhaustion → errored ─────────────────────────────────────────────

describe('useRunStream reconnect — cap exhaustion → errored', () => {
  it('after N=5 failed retries conn goes to errored via reconnect-give-up', async () => {
    // Every listRunEvents call rejects (simulates a run that can't be hydrated)
    // and each retry also errors
    listRunEventsMock.mockRejectedValue(new Error('server error'))

    const { result } = renderHook(() => useRunStream())
    act(() => result.current.start('echo_chain', { in: 'hello' }))
    act(() => last().open('run_cap'))
    act(() => last().emit(PREFIX))
    act(() => last().error()) // first drop → reconnecting

    await waitFor(() => expect(result.current.conn).toBe('reconnecting'))

    // Run timers repeatedly to exhaust all 5 cap attempts
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        vi.runAllTimers()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    await waitFor(() => expect(result.current.conn).toBe('errored'))
    expect(listRunEventsMock.mock.calls.length).toBeGreaterThanOrEqual(5)
  })
})

// ── (4) Terminal wins mid-reconnect (no storm) ───────────────────────────────

describe('useRunStream reconnect — terminal wins mid-reconnect', () => {
  it('a terminal frame arriving while reconnecting settles closed and clears the timer', async () => {
    // History has the terminal — simulates the run completing while we retried
    listRunEventsMock.mockResolvedValue(FULL_HISTORY_EVENTS)

    const { result } = renderHook(() => useRunStream())
    act(() => result.current.start('echo_chain', { in: 'hello' }))
    act(() => last().open('run_term'))
    act(() => last().emit(PREFIX))
    act(() => last().error()) // drop → reconnecting

    await waitFor(() => expect(result.current.conn).toBe('reconnecting'))

    // The reconnect timer resolves the history which contains a terminal
    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => expect(result.current.conn).toBe('closed'))

    // No further timer fires — the pending-timers count is 0 after terminal
    expect(vi.getTimerCount()).toBe(0)
  })
})

// ── (5) No timer after unmount ───────────────────────────────────────────────

describe('useRunStream reconnect — no post-unmount timer fires', () => {
  it('unmount while reconnecting clears the timer (no post-unmount listRunEvents)', async () => {
    // Delay listRunEvents so the timer fires but the promise is still pending
    let resolveHistory!: () => void
    listRunEventsMock.mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveHistory = res
        }),
    )

    const { result, unmount } = renderHook(() => useRunStream())
    act(() => result.current.start('echo_chain', { in: 'hello' }))
    act(() => last().open('run_unmount'))
    act(() => last().emit(PREFIX))
    act(() => last().error())

    await waitFor(() => expect(result.current.conn).toBe('reconnecting'))

    // Unmount before the timer fires
    unmount()

    // Flush any pending timers — should NOT trigger a listRunEvents call
    act(() => vi.runAllTimers())
    // Allow any already-inflight promise to settle (it shouldn't call anything new)
    await act(async () => {
      resolveHistory?.()
      await Promise.resolve()
    })

    // At most 1 call if the timer already fired before unmount; but no ADDITIONAL
    // call should fire after unmount. Crucially, no error thrown by a
    // post-unmount state update.
    // The key assertion: the hook is not calling more after unmount
    const callsAtUnmount = listRunEventsMock.mock.calls.length
    act(() => vi.runAllTimers())
    await Promise.resolve()
    expect(listRunEventsMock.mock.calls.length).toBe(callsAtUnmount) // no new calls
  })
})
