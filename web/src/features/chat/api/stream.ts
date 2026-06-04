import { openSseStream } from '@/lib/sse'
import { CHAT_BASE } from './client'

/**
 * Imperative SSE wrapper for the streamed chat path (CHAT-01).
 *
 * POSTs over `openSseStream` (web/src/lib/sse.ts) with ONLY Content-Type — NO
 * Authorization, NO `X-Console-*`, NO `X-Session-Id` request header. Chat is
 * auth-none and the BFF strips a client session header; the `session_id` travels
 * in the JSON BODY only (T-04-02 / Pitfall 1). Mirror of `flow/api/stream.ts`'s
 * auth-none posture.
 *
 * CHAT-02: customer-support sets `X-Session-Id` on the open response BEFORE the
 * first frame (server assigns a UUID when the body omits `session_id`). This
 * wrapper uses `openSseStream`'s `onOpen(response)` hook to read that header and
 * invoke `onSession(id)` EXACTLY ONCE — the chat mirror of the Phase-3 X-Run-ID
 * seam (`flow/api/stream.ts` makeOnOpen). A reconnect (a second open) does not
 * re-fire onSession.
 *
 * Streams are driven imperatively (NOT through TanStack Query). `onMessage`
 * forwards the raw `{ event, data }` frame; the caller parses `data` into the
 * StreamEnvelope.
 */

export type ChatStreamHandlers = {
  /** Each SSE frame: `event` is the kind (step/done/error), `data` the JSON. */
  onMessage: (frame: { event?: string; data: string }) => void
  /** Fired once with the session_id read from the `X-Session-Id` open header. */
  onSession?: (sessionId: string) => void
  /** Transport error (no terminal frame) — Phase 5 adds reconnect here. */
  onError?: (err: unknown) => void
}

/** Wrap the onOpen hook so onSession fires at most once per stream. */
function makeOnSession(onSession?: (sessionId: string) => void) {
  let fired = false
  return (response: Response) => {
    if (fired) return
    const sid = response.headers.get('X-Session-Id')
    if (sid) {
      fired = true
      onSession?.(sid)
    }
  }
}

/**
 * POST /api/chat/chat/stream — open a live streamed turn. `sessionId` is OMITTED
 * on the first turn (the server assigns one, surfaced via onSession) and echoed
 * on every later turn — always in the BODY. Returns the openSseStream promise
 * (resolves on clean close, rejects on transport drop / abort).
 */
export function chatStream(
  message: string,
  sessionId: string | undefined,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  return openSseStream({
    url: `${CHAT_BASE}/chat/stream`,
    method: 'POST',
    body: JSON.stringify({ message, session_id: sessionId }),
    signal,
    onOpen: makeOnSession(handlers.onSession),
    onMessage: handlers.onMessage,
    onError: handlers.onError,
  })
}
