import {
  recallResponseSchema,
  memoryItemSchema,
  gatewayErrorSchema,
  memoryConflictDetailsSchema,
  type RecallResponse,
  type MemoryItem,
  type WriteRecord,
  type PatchFields,
  type MemoryConflictDetails,
} from './schemas'

/**
 * Typed `/api/memory/*` client.
 *
 * Base path = the Phase-1 BFF prefix (router StripPrefix "/api/memory" →
 * gateway "/memory/*"; A2 resolved against executed Phase-1 code).
 *
 * Every fetcher takes the Phase-1 `apiFetch` (the function returned by
 * makeApiFetcher) as its first arg, so the `X-Console-*` identity headers are
 * injected by the single Phase-1 injection point. This client NEVER sets
 * client-trusted tenant/user identity headers — the BFF re-materializes the
 * authoritative scope from X-Console-* (T-02-01). Request bodies carry
 * `scope: {}`; the gateway's MergeAuthoritativeScope forces the header scope, so
 * an empty body scope avoids duplicating/leaking identity client-side (V4).
 *
 * OCC: every mutation threads `expected_version` (>0). write is the exception —
 * it carries a fresh `idempotency_key` instead. A `409 memory_conflict` is a
 * first-class, recoverable error surfaced by parseGatewayError.
 */
export const MEMORY_BASE = '/api/memory'

/** The function shape returned by Phase-1 makeApiFetcher(ctx). */
export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

/** A normalized gateway error a caller can `throw`. */
export type NormalizedGatewayError = {
  error: {
    code: string
    message: string
    request_id: string
    retryable: boolean
    details: Record<string, unknown>
  }
  httpStatus: number
  /** Narrowed details when code === "memory_conflict" (OCC recovery). */
  conflict?: MemoryConflictDetails
}

/**
 * Read the gateway error envelope off a non-2xx Response. Tolerant: if the body
 * is not the standard envelope, returns a synthetic transport_error so callers
 * always get a consistent shape. RETURNS (does not throw) so call sites throw it.
 */
export async function parseGatewayError(
  res: Response,
): Promise<NormalizedGatewayError> {
  let raw: unknown
  try {
    raw = await res.json()
  } catch {
    raw = undefined
  }

  const parsed = gatewayErrorSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      error: {
        code: 'transport_error',
        message: res.statusText || 'gateway request failed',
        request_id: '',
        retryable: false,
        details: {},
      },
      httpStatus: res.status,
    }
  }

  const normalized: NormalizedGatewayError = {
    error: parsed.data.error,
    httpStatus: res.status,
  }

  if (parsed.data.error.code === 'memory_conflict') {
    const conflict = memoryConflictDetailsSchema.safeParse(
      parsed.data.error.details,
    )
    if (conflict.success) normalized.conflict = conflict.data
  }

  return normalized
}

// ── Recall + read ───────────────────────────────────────────────────────────

export type RecallParams = {
  query: string
  top_k?: number
  consistency_level?: 'eventual' | 'bounded' | 'strong'
}

/**
 * POST /api/memory/recall/unified. Sends ONLY the documented request fields.
 * It deliberately omits any rank/skip/seek/window params: the gateway uses
 * DisallowUnknownFields, so any unknown key is a hard 400. Result ordering,
 * paging, and state-filtering are all client-side (D-03/D-13).
 */
export async function recall(
  apiFetch: ApiFetch,
  params: RecallParams,
): Promise<RecallResponse> {
  const res = await apiFetch(`${MEMORY_BASE}/recall/unified`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      scope: {},
      query: params.query,
      top_k: params.top_k ?? 8,
      ...(params.consistency_level
        ? { consistency_level: params.consistency_level }
        : {}),
    }),
  })
  if (!res.ok) throw await parseGatewayError(res)
  return recallResponseSchema.parse(await res.json())
}

/** GET /api/memory/items/{id} — the canonical full item. */
export async function getItem(
  apiFetch: ApiFetch,
  id: string,
): Promise<MemoryItem> {
  const res = await apiFetch(`${MEMORY_BASE}/items/${id}`)
  if (!res.ok) throw await parseGatewayError(res)
  return memoryItemSchema.parse(await res.json())
}

// ── Mutations ───────────────────────────────────────────────────────────────

export type WriteResponse = {
  memory: { memory_id: string; version: number; status: string }
}

/**
 * POST /api/memory/write. No expected_version (it creates); carries a fresh
 * idempotency_key so retries are safe. The lean response is { memory: {...} }
 * (no body) — callers refetch GET item for the authoritative content (D-09).
 */
export async function write(
  apiFetch: ApiFetch,
  record: WriteRecord,
): Promise<WriteResponse> {
  const res = await apiFetch(`${MEMORY_BASE}/write`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      scope: {},
      record,
    }),
  })
  if (!res.ok) throw await parseGatewayError(res)
  return (await res.json()) as WriteResponse
}

export type MutationVersionResponse = { memory_id: string; version: number }

/**
 * PATCH /api/memory/items/{id}. Threads expected_version (OCC) + a fresh
 * idempotency_key. The lean response is { memory_id, version } only — callers
 * refetch GET item for the new body (D-09).
 */
export async function patch(
  apiFetch: ApiFetch,
  id: string,
  fields: PatchFields,
  expected_version: number,
): Promise<MutationVersionResponse> {
  const res = await apiFetch(`${MEMORY_BASE}/items/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      scope: {},
      expected_version,
      patch: fields,
    }),
  })
  if (!res.ok) throw await parseGatewayError(res)
  return (await res.json()) as MutationVersionResponse
}

export type PinResponse = {
  memory_id: string
  version: number
  pinned: boolean
}
export type DisableResponse = {
  memory_id: string
  version: number
  disabled: boolean
}

/** Shared body-bearing POST for the flag-toggle lifecycle endpoints. */
async function lifecyclePost<T>(
  apiFetch: ApiFetch,
  id: string,
  action: 'pin' | 'unpin' | 'disable' | 'enable',
  expected_version: number,
): Promise<T> {
  const res = await apiFetch(`${MEMORY_BASE}/items/${id}/${action}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ scope: {}, expected_version }),
  })
  if (!res.ok) throw await parseGatewayError(res)
  return (await res.json()) as T
}

/** POST /api/memory/items/{id}/pin → { memory_id, version, pinned }. */
export function pin(apiFetch: ApiFetch, id: string, expected_version: number) {
  return lifecyclePost<PinResponse>(apiFetch, id, 'pin', expected_version)
}

/** POST /api/memory/items/{id}/unpin → { memory_id, version, pinned }. */
export function unpin(apiFetch: ApiFetch, id: string, expected_version: number) {
  return lifecyclePost<PinResponse>(apiFetch, id, 'unpin', expected_version)
}

/** POST /api/memory/items/{id}/disable → { memory_id, version, disabled }. */
export function disable(
  apiFetch: ApiFetch,
  id: string,
  expected_version: number,
) {
  return lifecyclePost<DisableResponse>(
    apiFetch,
    id,
    'disable',
    expected_version,
  )
}

/** POST /api/memory/items/{id}/enable → { memory_id, version, disabled }. */
export function enable(
  apiFetch: ApiFetch,
  id: string,
  expected_version: number,
) {
  return lifecyclePost<DisableResponse>(apiFetch, id, 'enable', expected_version)
}

export type DeleteResponse = {
  memory_id: string
  deleted: boolean
  version: number
}

/**
 * DELETE /api/memory/items/{id}. This DELETE CARRIES A BODY ({scope,
 * expected_version}) and so MUST set Content-Type: application/json — the
 * gateway's EnsureJSONRequest 400s a body-bearing DELETE without it (Pitfall 6).
 */
export async function del(
  apiFetch: ApiFetch,
  id: string,
  expected_version: number,
): Promise<DeleteResponse> {
  const res = await apiFetch(`${MEMORY_BASE}/items/${id}`, {
    method: 'DELETE',
    headers: JSON_HEADERS,
    body: JSON.stringify({ scope: {}, expected_version }),
  })
  if (!res.ok) throw await parseGatewayError(res)
  return (await res.json()) as DeleteResponse
}
