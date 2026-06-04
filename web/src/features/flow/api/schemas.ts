import { z } from 'zod'

/**
 * Zod schemas mirroring the VERIFIED flowd wire contract (03-RESEARCH.md "THE
 * FLOWD CONTRACT" + the 6-kind SSE frame schema). These narrow the untrusted
 * upstream flowd JSON before it reaches UI state (T-03-02 input validation).
 *
 * flowd is the AUTHORITATIVE validator (compileProbe returns 400 on a bad flow)
 * — these schemas mirror the wire shape, they do not replace flowd's semantics.
 *
 * NOTE: the flowd error envelope is FLAT `{ "error": "string" }` — NOT the
 * memory gateway's nested `{ error: { code, message, ... } }`. A flow-specific
 * `flowdErrorSchema` + `parseFlowdError` (client.ts) handle it; do NOT reuse
 * Phase-2's `parseGatewayError`.
 */

// ── Flow DTOs ───────────────────────────────────────────────────────────────

/** FlowMeta = { id, name?, created_at, updated_at }. */
export const flowMetaSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type FlowMeta = z.infer<typeof flowMetaSchema>

/**
 * FlowRecord = FlowMeta + { json }. `json` is Go `[]byte` → it arrives as a
 * base64 STRING on the wire. The schema validates it as a string and does NOT
 * decode it — `getFlow` (client.ts) base64-decodes it in one helper so the
 * decode lives in a single place (A1).
 */
export const flowRecordSchema = flowMetaSchema.extend({
  json: z.string(),
})
export type FlowRecord = z.infer<typeof flowRecordSchema>

// ── Run DTOs ────────────────────────────────────────────────────────────────

/** status ∈ {running, done, failed}. */
export const runStatusEnum = z.enum(['running', 'done', 'failed'])
export type RunStatus = z.infer<typeof runStatusEnum>

/** RunMeta = { id, flow_id, status, started_at, finished_at? } (nil while running). */
export const runMetaSchema = z.object({
  id: z.string(),
  flow_id: z.string(),
  status: runStatusEnum,
  started_at: z.string(),
  finished_at: z.string().optional(),
})
export type RunMeta = z.infer<typeof runMetaSchema>

/** RunRecord = RunMeta + optional { inputs, outputs, error }. */
export const runRecordSchema = runMetaSchema.extend({
  inputs: z.record(z.string(), z.string()).optional(),
  outputs: z.record(z.string(), z.string()).optional(),
  error: z.string().optional(),
})
export type RunRecord = z.infer<typeof runRecordSchema>

// ── SSE frame contract (the renderer contract) ──────────────────────────────

/**
 * The 6 SSE event kinds (flowd `eventKindString`). flow_done / flow_err are
 * terminal. The reducer (plan 03-03) keys on these; this plan supplies the enum
 * + payload schema the mock + client validate against.
 */
export const sseKindEnum = z.enum([
  'flow_started',
  'node_started',
  'node_finished',
  'node_skipped',
  'flow_done',
  'flow_err',
])
export type SseKind = z.infer<typeof sseKindEnum>

/**
 * The SSE `data:` payload (`streamPayload`) — an object carrying only the
 * POPULATED keys (each omitted when empty). All keys optional; `.loose()` so an
 * unknown upstream key never rejects a frame. There is NO `seq`/`ts`/`id` in the
 * SSE payload (those live only in the `GET /events` RunEvent JSON) — that
 * absence is the de-dup constraint the reducer handles in 03-03.
 */
export const ssePayloadSchema = z
  .object({
    flow: z.string().optional(),
    node: z.string().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    outputs: z.record(z.string(), z.string()).optional(),
    error: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .loose()
export type SsePayload = z.infer<typeof ssePayloadSchema>

/**
 * RunEvent (from `GET /runs/{id}/events`) — this is the ONLY place `seq` exists
 * (the SSE frame omits it). payload is the same streamPayload shape.
 */
export const runEventSchema = z.object({
  seq: z.number(),
  kind: sseKindEnum,
  node_id: z.string().optional(),
  payload: ssePayloadSchema,
  ts: z.string(),
})
export type RunEvent = z.infer<typeof runEventSchema>

// ── Error envelope (FLAT) ───────────────────────────────────────────────────

/**
 * The flowd error envelope — FLAT `{ "error": "string" }` (flowd `writeError` →
 * `errorResponse{Error string}`). A body missing `error` (or with a non-string
 * `error`) fails this schema so `parseFlowdError` can fall back to statusText.
 */
export const flowdErrorSchema = z.object({
  error: z.string(),
})
export type FlowdErrorBody = z.infer<typeof flowdErrorSchema>
