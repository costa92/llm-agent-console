import { fetchEventSource } from '@microsoft/fetch-event-source'

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
  onError?: (err: unknown) => void
  signal?: AbortSignal
}

export async function openSseStream(opts: SseStreamOptions): Promise<void> {
  await fetchEventSource(opts.url, {
    method: opts.method ?? 'POST',
    body: opts.body,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    signal: opts.signal,
    onmessage(ev) {
      opts.onMessage({ data: ev.data, event: ev.event })
    },
    onerror: opts.onError,
  })
}
