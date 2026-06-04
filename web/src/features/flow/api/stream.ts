import { openSseStream } from '@/lib/sse'
import { FLOW_BASE } from './client'

/**
 * Imperative SSE wrappers for the streamed run + replay paths.
 *
 * Both POST over `openSseStream` (web/src/lib/sse.ts) with ONLY Content-Type —
 * NO Authorization, NO `X-Console-*` (the BFF flow director injects the flowd
 * bearer server-side; the console sends none — T-03-01).
 *
 * D-08: flowd sets `X-Run-ID` on the open response BEFORE the first frame. Each
 * wrapper uses `openSseStream`'s `onOpen(response)` hook to read that header and
 * invoke `onRunId(runId)` EXACTLY ONCE — this is how a live run learns its
 * shareable run_id for the deep-linkable sub-route. A reconnect (a second open
 * for the same run) does not re-fire onRunId.
 *
 * Streams are driven imperatively (NOT through TanStack Query) — this module is
 * the seam the reducer/hook (plan 03-03) builds on. `onMessage` forwards the raw
 * `{ event, data }` frame; the caller parses `data` into the streamPayload.
 */

export type StreamHandlers = {
  /** Each SSE frame: `event` is the kind, `data` is the JSON payload string. */
  onMessage: (frame: { event?: string; data: string }) => void
  /** Fired once with the run_id read from the `X-Run-ID` open header (D-08). */
  onRunId?: (runId: string) => void
  /** Transport error (no terminal frame) — Phase 5 adds reconnect here. */
  onError?: (err: unknown) => void
}

/** Wrap the onOpen hook so onRunId fires at most once per stream. */
function makeOnOpen(onRunId?: (runId: string) => void) {
  let fired = false
  return (response: Response) => {
    if (fired) return
    const runId = response.headers.get('X-Run-ID')
    if (runId) {
      fired = true
      onRunId?.(runId)
    }
  }
}

/**
 * POST /api/flow/flows/{id}/run/stream — open a live streamed run. Returns the
 * openSseStream promise (resolves on clean close, rejects on transport drop).
 */
export function runStream(
  flowId: string,
  inputs: Record<string, string>,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  return openSseStream({
    url: `${FLOW_BASE}/flows/${flowId}/run/stream`,
    method: 'POST',
    body: JSON.stringify({ inputs }),
    signal,
    onOpen: makeOnOpen(handlers.onRunId),
    onMessage: handlers.onMessage,
    onError: handlers.onError,
  })
}

/**
 * POST /api/flow/runs/{id}/replay — re-stream a completed run's persisted events
 * (byte-identical frames → the SAME reducer/renderer as live; success
 * criterion 5). Also carries `X-Run-ID` (+ `X-Replay: true`) on open.
 */
export function replayStream(
  runId: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  return openSseStream({
    url: `${FLOW_BASE}/runs/${runId}/replay`,
    method: 'POST',
    body: '{}',
    signal,
    onOpen: makeOnOpen(handlers.onRunId),
    onMessage: handlers.onMessage,
    onError: handlers.onError,
  })
}
