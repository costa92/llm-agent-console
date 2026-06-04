import { vi } from 'vitest'

/**
 * Controllable fake SSE source for the imperative stream client.
 *
 * The console drives SSE through the `openSseStream` wrapper (web/src/lib/sse.ts),
 * so tests mock THAT wrapper rather than the raw network — per the validation
 * plan ("Mock the wrapper + listRunEvents, not the network"). This module
 * provides a controllable emitter that lets a test:
 *   (a) push a SCRIPTED sequence of `{ event, data }` frames,
 *   (b) supply an OPEN Response with arbitrary headers — specifically an
 *       `X-Run-ID` header — so the onOpen → onRunId (D-08) path is exercised,
 *   (c) trigger an optional onError / resolve a clean close vs reject a drop.
 *
 * It also ships the four golden frame sequences (success / failure / node_skipped
 * / late-join overlap) verified against flowd's `server_events_test.go`.
 *
 * Usage (mocking the openSseStream wrapper):
 *
 *   const fake = makeFakeSseStream()
 *   vi.mock('@/lib/sse', () => ({ openSseStream: fake.openSseStream }))
 *   // ... trigger the stream, then:
 *   await fake.emitOpen({ 'X-Run-ID': 'run_42' })   // drives onOpen → onRunId
 *   fake.emit(goldenSuccess)                          // scripted frames
 *   await fake.close()                                // resolves the promise
 */

export type SseFrame = { event: string; data: string }

/** Build `{ event, data }` frames from `{ kind, payload }` pairs. */
export function frames(
  pairs: Array<{ kind: string; payload: unknown }>,
): SseFrame[] {
  return pairs.map((p) => ({ event: p.kind, data: JSON.stringify(p.payload) }))
}

// ── Golden frame sequences (verified flowd shapes) ──────────────────────────

/** flow_started → node_started → node_finished → flow_done (terminal). */
export const goldenSuccess = frames([
  { kind: 'flow_started', payload: { flow: 'echo_chain' } },
  { kind: 'node_started', payload: { node: 'upper', input: { in: 'hello' } } },
  { kind: 'node_finished', payload: { node: 'upper', output: { out: 'OLLEH' } } },
  { kind: 'flow_done', payload: { flow: 'echo_chain', outputs: { out: 'OLLEH' } } },
])

/** ...ends in flow_err (terminal) carrying the failure message. */
export const goldenFailure = frames([
  { kind: 'flow_started', payload: { flow: 'echo_chain' } },
  { kind: 'node_started', payload: { node: 'upper', input: {} } },
  { kind: 'flow_err', payload: { error: 'missing required input: in' } },
])

/** ...includes a node_skipped (unmet edge condition) before flow_done. */
export const goldenNodeSkipped = frames([
  { kind: 'flow_started', payload: { flow: 'router_flow' } },
  { kind: 'node_started', payload: { node: 'route', input: { in: 'a' } } },
  { kind: 'node_finished', payload: { node: 'route', output: { branch: 'left' } } },
  { kind: 'node_skipped', payload: { node: 'right_branch' } },
  { kind: 'node_started', payload: { node: 'left_branch', input: {} } },
  { kind: 'node_finished', payload: { node: 'left_branch', output: { out: 'L' } } },
  { kind: 'flow_done', payload: { flow: 'router_flow', outputs: { out: 'L' } } },
])

/**
 * Late-join overlap fixture: a hydrated history prefix [seq 1,2,3] plus a live
 * tail whose frames overlap the last history event (the 3rd) then continue
 * [3,4,5]. The reducer (plan 03-03) must merge these to [1,2,3,4,5] with the
 * overlapping event appearing once. Provided here so the reducer test can
 * consume the SAME shapes the emitter scripts.
 */
export const lateJoinHistory = [
  { seq: 1, kind: 'flow_started', payload: { flow: 'echo_chain' }, ts: 't1' },
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
    payload: { node: 'upper', output: { out: 'OLLEH' } },
    ts: 't3',
  },
]
/** The live tail that overlaps history at the 3rd event then continues. */
export const lateJoinLiveTail = frames([
  { kind: 'node_finished', payload: { node: 'upper', output: { out: 'OLLEH' } } },
  { kind: 'flow_done', payload: { flow: 'echo_chain', outputs: { out: 'OLLEH' } } },
])

// ── Controllable emitter (mocks the openSseStream wrapper) ──────────────────

type Captured = {
  url: string
  method?: string
  body?: string
  headers?: Record<string, string>
}

/** The shape of the captured openSseStream options the fake records. */
type FakeSseOptions = Captured & {
  onMessage: (e: { data: string; event?: string }) => void
  onOpen?: (r: Response) => void | Promise<void>
  onError?: (e: unknown) => void
}

/** A callable mock with the openSseStream signature (so the build's tsc -b is happy). */
type OpenSseStreamMock = ((opts: FakeSseOptions) => Promise<void>) & {
  mock: ReturnType<typeof vi.fn>['mock']
}

export type FakeSseStream = {
  /** The mock to pass to `vi.mock('@/lib/sse', () => ({ openSseStream }))`. */
  openSseStream: OpenSseStreamMock
  /** The captured options from the most recent openSseStream call. */
  captured: () => Captured | undefined
  /**
   * Drive the onOpen hook with a synthetic open Response carrying the supplied
   * headers (e.g. { 'X-Run-ID': 'run_42' }). Awaitable so onRunId has run.
   */
  emitOpen: (headers?: Record<string, string>) => Promise<void>
  /** Push one or more scripted frames to onMessage. */
  emit: (frame: SseFrame | SseFrame[]) => void
  /** Resolve the openSseStream promise (clean close). */
  close: () => Promise<void>
  /** Fire onError then reject the promise (transport drop). */
  fail: (err?: unknown) => Promise<void>
}

/**
 * Make a controllable fake `openSseStream`. The returned `openSseStream` records
 * the caller's options and parks until the test drives it via emitOpen/emit/
 * close/fail. The default open Response content-type is `text/event-stream` so
 * the wrapper's open-validation passes; pass a non-stream content-type header to
 * simulate a swallow-guard failure.
 */
export function makeFakeSseStream(): FakeSseStream {
  let opts: FakeSseOptions | undefined
  let resolveDone: (() => void) | undefined
  let rejectDone: ((e: unknown) => void) | undefined

  const openSseStream = vi.fn((o: FakeSseOptions) => {
    opts = o
    return new Promise<void>((resolve, reject) => {
      resolveDone = resolve
      rejectDone = reject
    })
  }) as unknown as OpenSseStreamMock

  return {
    openSseStream,
    captured: () =>
      opts && {
        url: opts.url,
        method: opts.method,
        body: opts.body,
        headers: opts.headers,
      },
    async emitOpen(headers = { 'Content-Type': 'text/event-stream' }) {
      const h = new Headers(headers)
      if (!h.has('Content-Type')) h.set('Content-Type', 'text/event-stream')
      await opts?.onOpen?.(new Response(null, { status: 200, headers: h }))
    },
    emit(frame) {
      const list = Array.isArray(frame) ? frame : [frame]
      for (const f of list) opts?.onMessage({ data: f.data, event: f.event })
    },
    async close() {
      resolveDone?.()
      await Promise.resolve()
    },
    async fail(err = new Error('transport drop')) {
      opts?.onError?.(err)
      rejectDone?.(err)
      await Promise.resolve()
    },
  }
}
