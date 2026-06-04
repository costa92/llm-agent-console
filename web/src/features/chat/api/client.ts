import { chatErrorSchema, chatResponseSchema, type ChatResponse } from './schemas'

/**
 * Typed `/api/chat/*` client.
 *
 * Base path = the Phase-1 BFF prefix (router StripPrefix "/api/chat" →
 * customer-support root). Chat is AUTH-NONE (IP rate-limited at the service):
 * the BFF chat director strips inbound `Authorization` + `X-Console-*` and
 * injects nothing. So this client uses plain same-origin `fetch` and sends ONLY
 * `Content-Type: application/json` — NO Authorization, NO `X-Console-*`, NO
 * `X-Session-Id` request header (T-04-02). The `session_id` travels in the JSON
 * BODY only (the BFF strips a client `X-Session-Id` header — Pitfall 1).
 *
 * The error envelope is FLAT `{ "error": "string" }` (customer-support
 * `ErrorResponse`) — a chat-specific `parseChatError` reads it; do NOT reuse
 * Phase-2's `parseGatewayError`.
 */
export const CHAT_BASE = '/api/chat'

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

/** A normalized chat error a caller can `throw`. */
export class ChatError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ChatError'
    this.status = status
  }
}

/**
 * Read the FLAT chat error envelope off a non-2xx Response. Tolerant: if the
 * body is not `{ error: string }`, falls back to `res.statusText`. RETURNS (does
 * not throw) so call sites `throw await parseChatError(res)`. Mirror of
 * `parseFlowdError`.
 */
export async function parseChatError(res: Response): Promise<ChatError> {
  let raw: unknown
  try {
    raw = await res.json()
  } catch {
    raw = undefined
  }
  const parsed = chatErrorSchema.safeParse(raw)
  const message = parsed.success
    ? parsed.data.error
    : res.statusText || 'chat request failed'
  return new ChatError(res.status, message)
}

/**
 * POST /api/chat/chat — the synchronous one-shot (CHAT-03). Sends ONLY
 * Content-Type + the body `{ message, session_id? }` (session_id omitted on the
 * first turn). On a non-2xx throws `await parseChatError(res)` (a send-failure —
 * the caller toasts + re-enables the composer). On ok returns the parsed
 * `{ answer, agent, session_id? }`.
 */
export async function chatSync(
  message: string,
  sessionId?: string,
): Promise<ChatResponse> {
  const res = await fetch(`${CHAT_BASE}/chat`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ message, session_id: sessionId }),
  })
  if (!res.ok) throw await parseChatError(res)
  return chatResponseSchema.parse(await res.json())
}
