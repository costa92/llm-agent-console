import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useRunStream } from './useRunStream'
import type { StreamHandlers } from '@/features/flow/api/stream'
import {
  goldenSuccess,
  goldenFailure,
  lateJoinHistory,
  type SseFrame,
} from '@/test/mocks/fetch-event-source'

/**
 * Unit tests for the imperative useRunStream hook (03-03 feature 3).
 *
 * The hook is mocked at the stream-wrapper + REST-client seam (NOT the network),
 * per the validation plan ("Mock the wrapper + listRunEvents, not the network").
 * A controllable fake captures the StreamHandlers each `runStream`/`replayStream`
 * call passes so the test can drive onRunId / onMessage / onError + resolve or
 * reject the stream promise deterministically — no live flowd.
 */

// ── Controllable fakes for stream.ts (runStream/replayStream) ────────────────

type Driver = {
  handlers: StreamHandlers
  signal?: AbortSignal
  resolve: () => void
  reject: (e: unknown) => void
  /** Emit the X-Run-ID open → onRunId. */
  open: (runId: string) => void
  /** Emit scripted SSE frames in order. */
  emit: (frames: SseFrame[]) => void
  /** Fire onError (transport drop). */
  error: (e?: unknown) => void
}

const drivers: Driver[] = []
const runStreamMock = vi.fn()
const replayStreamMock = vi.fn()

function installStream(mock: ReturnType<typeof vi.fn>) {
  mock.mockImplementation(
    (
      _a: string,
      _b: unknown,
      handlersOrSignal: StreamHandlers | AbortSignal,
      maybeSignal?: AbortSignal,
    ) => {
      // runStream(flowId, inputs, handlers, signal) | replayStream(runId, handlers, signal)
      let handlers: StreamHandlers
      let signal: AbortSignal | undefined
      if (
        handlersOrSignal &&
        typeof (handlersOrSignal as StreamHandlers).onMessage === 'function'
      ) {
        handlers = handlersOrSignal as StreamHandlers
        signal = maybeSignal
      } else {
        handlers = _b as StreamHandlers // replayStream(runId, handlers, signal)
        signal = handlersOrSignal as AbortSignal
      }
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
        open: (runId) =>
          handlers.onRunId?.(runId),
        emit: (frames) => {
          for (const f of frames)
            handlers.onMessage({ event: f.event, data: f.data })
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
  replayStream: (...args: unknown[]) => replayStreamMock(...args),
}))
vi.mock('@/features/flow/api/client', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, listRunEvents: (...a: unknown[]) => listRunEventsMock(...a) }
})

beforeEach(() => {
  drivers.length = 0
  runStreamMock.mockReset()
  replayStreamMock.mockReset()
  listRunEventsMock.mockReset()
  installStream(runStreamMock)
  installStream(replayStreamMock)
})
afterEach(() => vi.clearAllMocks())

const last = () => drivers[drivers.length - 1]

describe('useRunStream — start() dispatches frames in order', () => {
  it('opens runStream, sets streaming, and folds frames into the reducer in order', async () => {
    const { result } = renderHook(() => useRunStream())

    act(() => {
      result.current.start('echo_chain', { in: 'hello' })
    })
    expect(runStreamMock).toHaveBeenCalledTimes(1)
    expect(result.current.conn).toBe('streaming')

    act(() => {
      last().emit(goldenSuccess)
    })

    await waitFor(() => {
      expect(result.current.timeline.events.map((e) => e.kind)).toEqual([
        'flow_started',
        'node_started',
        'node_finished',
        'flow_done',
      ])
    })
    expect(result.current.timeline.terminal).toBe('done')
    expect(result.current.timeline.outputs).toEqual({ out: 'OLLEH' })
  })
})

describe('useRunStream — X-Run-ID surfacing (D-08)', () => {
  it('surfaces the run_id via onRunId AND exposes it as the returned runId', async () => {
    const onRunId = vi.fn()
    const { result } = renderHook(() => useRunStream())

    act(() => {
      result.current.start('echo_chain', {}, { onRunId })
    })
    act(() => {
      last().open('run_42')
    })

    await waitFor(() => expect(result.current.runId).toBe('run_42'))
    expect(onRunId).toHaveBeenCalledWith('run_42')
  })
})

describe('useRunStream — terminal aborts the stream (Pitfall 6)', () => {
  it('flow_done flips conn to closed and aborts the underlying fetch', async () => {
    const { result } = renderHook(() => useRunStream())
    act(() => result.current.start('echo_chain', {}))
    const signal = last().signal
    expect(signal?.aborted).toBe(false)

    act(() => last().emit(goldenSuccess))

    await waitFor(() => expect(result.current.conn).toBe('closed'))
    expect(signal?.aborted).toBe(true)
  })

  it('flow_err is terminal too: conn closed + aborted, error captured', async () => {
    const { result } = renderHook(() => useRunStream())
    act(() => result.current.start('echo_chain', {}))
    const signal = last().signal

    act(() => last().emit(goldenFailure))

    await waitFor(() => expect(result.current.conn).toBe('closed'))
    expect(signal?.aborted).toBe(true)
    expect(result.current.timeline.terminal).toBe('error')
    expect(result.current.timeline.error).toBe('missing required input: in')
  })
})

describe('useRunStream — transport error before terminal → errored', () => {
  it('onError with no terminal frame flips conn to errored', async () => {
    const { result } = renderHook(() => useRunStream())
    act(() => result.current.start('echo_chain', {}))

    act(() => last().error())

    await waitFor(() => expect(result.current.conn).toBe('errored'))
  })
})

describe('useRunStream — retry() hydrates /events on a KNOWN run (D-09 / IC-6)', () => {
  it('retry after a transport drop on a created run calls listRunEvents (NOT a fresh runStream) and de-dups', async () => {
    listRunEventsMock.mockResolvedValue(
      lateJoinHistory.map((r) => ({
        seq: r.seq,
        kind: r.kind,
        node_id: r.node_id,
        payload: r.payload,
        ts: r.ts,
      })),
    )

    const { result } = renderHook(() => useRunStream())
    act(() => result.current.start('echo_chain', {}))

    // The run was created (X-Run-ID arrived) and emitted a live prefix...
    act(() => last().open('run_77'))
    act(() => last().emit(goldenSuccess.slice(0, 3))) // flow_started, node_started, node_finished
    // ...then the transport drops.
    act(() => last().error())
    await waitFor(() => expect(result.current.conn).toBe('errored'))

    const runStreamCallsBefore = runStreamMock.mock.calls.length

    await act(async () => {
      await result.current.retry()
    })

    // Hydrated via GET /events — NOT a fresh /run/stream POST.
    expect(listRunEventsMock).toHaveBeenCalledWith('run_77')
    expect(runStreamMock.mock.calls.length).toBe(runStreamCallsBefore)

    // The history re-send of the already-played prefix de-dups (no doubling).
    expect(
      result.current.timeline.events.filter(
        (e) => e.kind === 'node_finished' && e.node === 'upper',
      ),
    ).toHaveLength(1)
    expect(result.current.timeline.events.map((e) => e.kind)).toEqual([
      'flow_started',
      'node_started',
      'node_finished',
    ])
  })

  it('retry with NO known runId re-opens runStream (a genuinely new attempt)', async () => {
    const { result } = renderHook(() => useRunStream())
    act(() => result.current.start('echo_chain', {}))
    // Stream dies BEFORE X-Run-ID arrives.
    act(() => last().error())
    await waitFor(() => expect(result.current.conn).toBe('errored'))

    const before = runStreamMock.mock.calls.length
    await act(async () => {
      await result.current.retry()
    })

    expect(runStreamMock.mock.calls.length).toBe(before + 1)
    expect(listRunEventsMock).not.toHaveBeenCalled()
  })
})

describe('useRunStream — replay() feeds the SAME reducer as history', () => {
  it('opens replayStream and folds frames as history → identical render model', async () => {
    const { result } = renderHook(() => useRunStream())
    act(() => result.current.replay('run_99'))
    expect(replayStreamMock).toHaveBeenCalledTimes(1)

    act(() => last().emit(goldenSuccess))

    await waitFor(() =>
      expect(result.current.timeline.terminal).toBe('done'),
    )
    expect(result.current.timeline.events.map((e) => e.kind)).toEqual([
      'flow_started',
      'node_started',
      'node_finished',
      'flow_done',
    ])
    // every folded event is tagged history
    expect(result.current.timeline.events.every((e) => e.source === 'history')).toBe(
      true,
    )
  })
})

describe('useRunStream — unmount aborts the in-flight stream', () => {
  it('aborts the AbortController on unmount', () => {
    const { result, unmount } = renderHook(() => useRunStream())
    act(() => result.current.start('echo_chain', {}))
    const signal = last().signal
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
  })
})
