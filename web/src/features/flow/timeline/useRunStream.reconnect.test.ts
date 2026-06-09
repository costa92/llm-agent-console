import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRunStream } from './useRunStream'
import type { StreamHandlers } from '@/features/flow/api/stream'
import { frames, type SseFrame } from '@/test/mocks/fetch-event-source'

/**
 * Reconnect loop tests for useRunStream (05-03 Task 1).
 *
 * Strategy: inject rng=()=>0 so nextDelay always returns 0ms. Timers fire as
 * setTimeout(..., 0). Use vi.useFakeTimers({ shouldAdvanceTime: true }) so
 * testing-library's waitFor / polling still work while we control timer execution.
 * Drive timers via vi.advanceTimersByTimeAsync(0) inside act().
 *
 * Exercises:
 *   - transport drop → 'reconnecting' (attempt 1/N)
 *   - timer fires → retry() via listRunEvents (de-dup on hydrate)
 *   - successful resume → 'streaming' / terminal → 'closed'
 *   - cap exhaustion → 'errored' via reconnect-give-up
 *   - terminal wins mid-reconnect → 'closed', timer cleared
 *   - no timer fires after unmount
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

/** rng=()=>0 → nextDelay always returns 0ms → timers fire as setTimeout(...,0). */
const ZERO_RNG = () => 0

/** Prefix frames: flow_started + node_started (no terminal). */
const PREFIX = frames([
  { kind: 'flow_started', payload: { flow: 'echo_chain' } },
  { kind: 'node_started', payload: { node: 'upper', input: { in: 'hello' } } },
])

/** Full history (prefix + tail + terminal). */
const FULL_HISTORY_EVENTS = [
  { seq: 1, kind: 'flow_started', node_id: undefined, payload: { flow: 'echo_chain' }, ts: 't1' },
  { seq: 2, kind: 'node_started', node_id: 'upper', payload: { node: 'upper', input: { in: 'hello' } }, ts: 't2' },
  { seq: 3, kind: 'node_finished', node_id: 'upper', payload: { node: 'upper', output: { out: 'HELLO' } }, ts: 't3' },
  { seq: 4, kind: 'flow_done', node_id: undefined, payload: { flow: 'echo_chain', outputs: { out: 'HELLO' } }, ts: 't4' },
]

/** Full history without a terminal — run still in-flight. */
const PARTIAL_HISTORY_EVENTS = FULL_HISTORY_EVENTS.slice(0, 3)

beforeEach(() => {
  drivers.length = 0
  runStreamMock.mockReset()
  listRunEventsMock.mockReset()
  installRunStream()
  // shouldAdvanceTime=true keeps testing-library's internal setTimeout working.
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.runAllTimers()
  vi.useRealTimers()
  vi.clearAllMocks()
})

/**
 * Flush one round of the reconnect loop:
 * 1. Advance fake timers by the maximum possible delay so any pending setTimeout fires.
 * 2. Flush all microtasks (promise resolution chains).
 * Must be called inside act() to batch React state updates.
 */
async function flushReconnect() {
  await vi.advanceTimersByTimeAsync(30_000)
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

// ── (1) Drop → reconnecting (attempt exposed) ────────────────────────────────

describe('useRunStream reconnect — drop → reconnecting with attempt counter', () => {
  it('a transport drop enters reconnecting and exposes attempt=1, cap=5', async () => {
    listRunEventsMock.mockImplementation(() => new Promise<never>(() => {}))

    const { result } = renderHook(() => useRunStream({ rng: ZERO_RNG }))

    act(() => result.current.start('echo_chain', { in: 'hello' }))
    act(() => last().open('run_1'))
    act(() => last().emit(PREFIX))
    act(() => last().error()) // drop → reconnecting

    expect(result.current.conn).toBe('reconnecting')

    // Advance timer so the loop sets attempt=1
    await act(async () => {
      await flushReconnect()
    })

    expect(result.current.attempt).toBe(1)
    expect(result.current.cap).toBe(5)
  })
})

// ── (2) Successful resume via /events (de-dup) ───────────────────────────────

describe('useRunStream reconnect — resume via /events with de-dup', () => {
  it('fires retry on timer, hydrates /events, de-dups prefix, returns closed', async () => {
    listRunEventsMock.mockResolvedValue(FULL_HISTORY_EVENTS)

    const { result } = renderHook(() => useRunStream({ rng: ZERO_RNG }))
    act(() => result.current.start('echo_chain', { in: 'hello' }))
    act(() => last().open('run_2'))
    act(() => last().emit(PREFIX)) // live prefix
    act(() => last().error())      // drop → reconnecting

    expect(result.current.conn).toBe('reconnecting')

    await act(async () => {
      await flushReconnect()
    })

    expect(listRunEventsMock).toHaveBeenCalledWith('run_2')
    expect(result.current.conn).toBe('closed')

    // De-dup: prefix events appear exactly once
    const kinds = result.current.timeline.events.map((e) => e.kind)
    expect(kinds.filter((k) => k === 'flow_started')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'node_started')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'node_finished')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'flow_done')).toHaveLength(1)
  })

  it('resume without terminal: conn returns to streaming (reconnect-success)', async () => {
    listRunEventsMock.mockResolvedValue(PARTIAL_HISTORY_EVENTS)

    const { result } = renderHook(() => useRunStream({ rng: ZERO_RNG }))
    act(() => result.current.start('echo_chain', { in: 'hello' }))
    act(() => last().open('run_3'))
    act(() => last().emit(PREFIX))
    act(() => last().error())

    expect(result.current.conn).toBe('reconnecting')

    await act(async () => {
      await flushReconnect()
    })

    expect(result.current.conn).toBe('streaming')
    expect(result.current.attempt).toBe(0) // reset after success
  })
})

// ── (3) Cap exhaustion → errored ─────────────────────────────────────────────

describe('useRunStream reconnect — cap exhaustion → errored', () => {
  it('after N=5 failed retries conn goes to errored via reconnect-give-up', async () => {
    listRunEventsMock.mockRejectedValue(new Error('server error'))

    const { result } = renderHook(() => useRunStream({ rng: ZERO_RNG }))
    act(() => result.current.start('echo_chain', { in: 'hello' }))
    act(() => last().open('run_cap'))
    act(() => last().emit(PREFIX))
    act(() => last().error())

    expect(result.current.conn).toBe('reconnecting')

    // Flush enough rounds to exhaust cap (cap=5; need 6 rounds: 5 attempts + give-up)
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await flushReconnect()
      })
    }

    expect(result.current.conn).toBe('errored')
    expect(listRunEventsMock.mock.calls.length).toBeGreaterThanOrEqual(5)
  })
})

// ── (4) Terminal wins mid-reconnect (no storm) ───────────────────────────────

describe('useRunStream reconnect — terminal wins mid-reconnect', () => {
  it('a terminal frame arriving while reconnecting settles closed and clears the timer', async () => {
    listRunEventsMock.mockResolvedValue(FULL_HISTORY_EVENTS)

    const { result } = renderHook(() => useRunStream({ rng: ZERO_RNG }))
    act(() => result.current.start('echo_chain', { in: 'hello' }))
    act(() => last().open('run_term'))
    act(() => last().emit(PREFIX))
    act(() => last().error())

    expect(result.current.conn).toBe('reconnecting')

    await act(async () => {
      await flushReconnect()
    })

    expect(result.current.conn).toBe('closed')
    // No further timers pending after terminal settled
    expect(vi.getTimerCount()).toBe(0)
  })
})

// ── (5) No timer after unmount ───────────────────────────────────────────────

describe('useRunStream reconnect — no post-unmount timer fires', () => {
  it('unmount while reconnecting clears the timer (no post-unmount listRunEvents)', async () => {
    listRunEventsMock.mockImplementation(() => new Promise<never>(() => {}))

    const { result, unmount } = renderHook(() => useRunStream({ rng: ZERO_RNG }))
    act(() => result.current.start('echo_chain', { in: 'hello' }))
    act(() => last().open('run_unmount'))
    act(() => last().emit(PREFIX))
    act(() => last().error())

    expect(result.current.conn).toBe('reconnecting')

    // Unmount before the timer fires
    unmount()

    const callsBefore = listRunEventsMock.mock.calls.length

    // Flush timers — the timer was cleared by clearReconnect() on unmount
    await act(async () => {
      await flushReconnect()
    })

    // No new listRunEvents calls
    expect(listRunEventsMock.mock.calls.length).toBe(callsBefore)
  })
})

// ── (6) Baseline: drop→reconnecting still works ──────────────────────────────

describe('useRunStream reconnect — transport-error enters reconnecting (D-03)', () => {
  it('onError with no terminal frame flips conn to reconnecting', async () => {
    listRunEventsMock.mockImplementation(() => new Promise<never>(() => {}))

    const { result } = renderHook(() => useRunStream({ rng: ZERO_RNG }))
    act(() => result.current.start('echo_chain', {}))
    act(() => last().error())

    expect(result.current.conn).toBe('reconnecting')
  })
})
