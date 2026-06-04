import { z } from 'zod'

/**
 * Zod schemas mirroring the VERIFIED customer-support chat wire contract
 * (04-RESEARCH.md "The Verified Chat Contract"). These narrow the untrusted
 * upstream JSON before it reaches UI state (T-04-01 input validation).
 *
 * The streamed frame is an SSE named event (`step`/`done`/`error`) whose `data:`
 * line is a JSON `StreamEnvelope{kind, answer?, error?}`. `kind` is a Go `string`
 * (an OPEN set — the six agent StepKind values plus the two terminal markers), so
 * `streamEnvelopeSchema` is `.loose()`: an unknown future kind and any extra
 * upstream key survive rather than reject the frame.
 *
 * NOTE: a `step` frame carries its text in `answer` (NOT a `content` field —
 * Pitfall 2). `Step.Tool`/`Args`/`Result` are NOT on the wire (Pitfall in
 * RESEARCH), so they are deliberately absent from the schema.
 *
 * The error envelope is FLAT `{ "error": "string" }` — same shape as flowd, NOT
 * the memory gateway's nested envelope. A chat-specific `parseChatError`
 * (client.ts) reads it; do NOT reuse Phase-2's `parseGatewayError`.
 */

// ── Request DTO (both endpoints) ─────────────────────────────────────────────

/**
 * ChatRequest = { message, session_id? }. `session_id` is OMITTED on the first
 * turn (the server assigns one) and echoed on every later turn — always in the
 * BODY, never a header (Pitfall 1).
 */
export const chatRequestSchema = z.object({
  message: z.string(),
  session_id: z.string().optional(),
})
export type ChatRequest = z.infer<typeof chatRequestSchema>

// ── Sync response DTO (POST /chat) ───────────────────────────────────────────

/** ChatResponse = { answer, agent, session_id? } (the sync one-shot reply). */
export const chatResponseSchema = z.object({
  answer: z.string(),
  agent: z.string(),
  session_id: z.string().optional(),
})
export type ChatResponse = z.infer<typeof chatResponseSchema>

// ── Streamed frame contract (the renderer contract) ──────────────────────────

/**
 * StreamEnvelope = { kind, answer?, error? }. `.loose()` so an unknown `kind`
 * (a future agent StepKind) and any extra upstream key never reject the frame —
 * the reducer keeps an unknown kind as a neutral step row (T-04-01). `kind`
 * disambiguates a step (any non-terminal kind) from the two terminal markers
 * `done` (final answer in `answer`) / `error` (failure in `error`).
 */
export const streamEnvelopeSchema = z
  .object({
    kind: z.string(),
    answer: z.string().optional(),
    error: z.string().optional(),
  })
  .loose()
export type StreamEnvelope = z.infer<typeof streamEnvelopeSchema>

// ── Error envelope (FLAT) ────────────────────────────────────────────────────

/**
 * The customer-support error envelope — FLAT `{ "error": "string" }`. A body
 * missing `error` (or with a non-string `error`) fails this schema so
 * `parseChatError` can fall back to statusText.
 */
export const chatErrorSchema = z.object({
  error: z.string(),
})
export type ChatErrorBody = z.infer<typeof chatErrorSchema>
