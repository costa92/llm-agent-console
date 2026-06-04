import { z } from 'zod'

/**
 * Zod schemas mirroring the VERIFIED memory-gateway wire contract
 * (02-RESEARCH.md "THE GATEWAY CONTRACT" + golden wire JSON). These narrow the
 * untrusted upstream JSON before it reaches UI state (V5 input validation) and
 * give the raw-JSON editor fast pre-submit feedback (D-07). The gateway remains
 * the authoritative validator — these schemas mirror its rules, they do not
 * replace it.
 */

/** kind ∈ {working, episodic, semantic} — the only valid memory kinds (D-07). */
export const kindEnum = z.enum(['working', 'episodic', 'semantic'])
export type MemoryKind = z.infer<typeof kindEnum>

/**
 * A single recall hit. metadata is passthrough-tolerant (the gateway may add
 * keys); the two documented keys are surfaced. tags/source/category are omitted
 * when empty on the wire, so they are optional here.
 */
export const recallHitSchema = z.object({
  memory_id: z.string(),
  kind: kindEnum,
  score: z.number(),
  version: z.number(),
  content: z.string(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
  category: z.string().optional(),
  pinned: z.boolean(),
  disabled: z.boolean(),
  metadata: z
    .object({
      matched_by: z.string().optional(),
      token_cost_estimate: z.number().optional(),
    })
    .loose()
    .optional(),
})
export type RecallHit = z.infer<typeof recallHitSchema>

/**
 * RecallUnifiedResponse — a flat ranked hits[] (score desc). No total/cursor/
 * paging envelope. Empty results are `{ hits: [] }` (a valid 200 → empty state).
 * trace is optional and loose (debug/observability only).
 */
export const recallResponseSchema = z.object({
  hits: z.array(recallHitSchema),
  trace: z.object({}).loose().optional(),
})
export type RecallResponse = z.infer<typeof recallResponseSchema>

/** GetMemoryItemResponse — the canonical "full item" (drawer detail + editor). */
export const memoryItemSchema = z.object({
  memory_id: z.string(),
  kind: kindEnum,
  version: z.number(),
  content: z.string(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
  category: z.string().optional(),
  importance: z.number().optional(),
  pinned: z.boolean(),
  disabled: z.boolean(),
})
export type MemoryItem = z.infer<typeof memoryItemSchema>

/**
 * WriteRecordPayload — the operator-edited `record` object only (NOT the
 * envelope; the client wraps idempotency_key + scope:{} around it). kind is
 * required and enum-validated; content is required and non-empty (D-07).
 */
export const writeRecordSchema = z.object({
  kind: kindEnum,
  content: z.string().min(1, 'content: required.'),
  source: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  importance: z.number().optional(),
  pinned: z.boolean().optional(),
})
export type WriteRecord = z.infer<typeof writeRecordSchema>

/**
 * PatchMemoryFields — the patchable subset only. content/category/tags/
 * importance are the ONLY patchable fields; kind/source/pinned/disabled are NOT
 * patchable (kind/source immutable post-write; flags change via the dedicated
 * pin/disable endpoints). `.strict()` rejects those so an operator pasting them
 * gets a clear error. `.refine()` requires at least one key so an empty no-op
 * patch is surfaced client-side before it reaches the gateway.
 */
export const patchFieldsSchema = z
  .object({
    content: z.string().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    importance: z.number().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'patch: provide at least one of content, category, tags, importance.',
  })
export type PatchFields = z.infer<typeof patchFieldsSchema>

/**
 * The standard gateway error envelope (errors.go). details is a loose record —
 * its shape depends on `code`; narrow it with memoryConflictDetailsSchema when
 * code === "memory_conflict".
 */
export const gatewayErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string(),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()),
  }),
})
export type GatewayError = z.infer<typeof gatewayErrorSchema>

/**
 * The 409 `memory_conflict` details — narrows error.details so callers can
 * drive the "refetch the item, retry with current_version" OCC recovery.
 */
export const memoryConflictDetailsSchema = z.object({
  memory_id: z.string(),
  expected_version: z.number(),
  current_version: z.number(),
})
export type MemoryConflictDetails = z.infer<typeof memoryConflictDetailsSchema>
