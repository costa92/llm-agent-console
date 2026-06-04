import {
  fetchEventSource,
  EventStreamContentType,
} from '@microsoft/fetch-event-source'

/**
 * Typed wrapper around @microsoft/fetch-event-source. Not consumed in Phase 1 —
 * inherited by Phase 3 flow SSE and Phase 4 chat SSE. Both stream endpoints are
 * POST (native EventSource is GET-only and cannot be used here).
 */
export interface SseStreamOptions {
  url: string
  method?: 'GET' | 'POST'
  body?: string
  headers?: Record<string, string>
  onMessage: (event: { data: string; event?: string }) => void
  /**
   * Invoked with the SSE response BEFORE any frame flows — lets callers read the
   * response headers (Phase 3: flowd's `X-Run-ID`, set before the first frame —
   * D-08). fetch-event-source calls this in place of its default open
   * validation, so this wrapper re-applies that default validation AFTER calling
   * `onOpen` — a non-2xx / wrong-content-type open is NOT swallowed.
   */
  onOpen?: (response: Response) => void | Promise<void>
  onError?: (err: unknown) => void
  signal?: AbortSignal
}

export async function openSseStream(opts: SseStreamOptions): Promise<void> {
  await fetchEventSource(opts.url, {
    method: opts.method ?? 'POST',
    body: opts.body,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    signal: opts.signal,
    async onopen(response) {
      // Surface the open Response (headers incl. X-Run-ID) to the caller first.
      await opts.onOpen?.(response)
      // Then PRESERVE fetch-event-source's default open validation: a response
      // whose content-type is not text/event-stream (e.g. a non-2xx JSON error
      // body) must throw, not be silently treated as a live stream.
      const contentType = response.headers.get('content-type')
      if (!contentType?.startsWith(EventStreamContentType)) {
        throw new Error(
          `Expected content-type to be ${EventStreamContentType}, Actual: ${contentType}`,
        )
      }
    },
    onmessage(ev) {
      opts.onMessage({ data: ev.data, event: ev.event })
    },
    onerror: opts.onError,
  })
}
