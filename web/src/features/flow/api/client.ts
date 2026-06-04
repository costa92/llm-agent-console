import {
  flowMetaSchema,
  flowRecordSchema,
  runMetaSchema,
  runRecordSchema,
  runEventSchema,
  flowdErrorSchema,
  type FlowMeta,
  type FlowRecord,
  type RunMeta,
  type RunRecord,
  type RunEvent,
} from './schemas'

/**
 * Typed `/api/flow/*` client.
 *
 * Base path = the Phase-1 BFF prefix (router StripPrefix "/api/flow" → flowd
 * root). flowd is NOT scope-aware: the BFF flow director strips inbound auth +
 * `X-Console-*` and injects `Bearer <FLOWD_TOKEN>` server-side. So this client
 * uses plain same-origin `fetch` and sends NO Authorization / NO `X-Console-*`
 * headers (T-03-01) — unlike the memory client, it does NOT thread apiFetch.
 *
 * The error envelope is FLAT `{ "error": "string" }` (flowd `writeError`) — a
 * flow-specific `parseFlowdError` reads it; do NOT reuse Phase-2's
 * `parseGatewayError`.
 */
export const FLOW_BASE = '/api/flow'

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

/** A normalized flowd error a caller can `throw`. */
export class FlowdError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'FlowdError'
    this.status = status
  }
}

/**
 * Read the FLAT flowd error envelope off a non-2xx Response. Tolerant: if the
 * body is not `{ error: string }`, falls back to `res.statusText`. RETURNS (does
 * not throw) so call sites `throw await parseFlowdError(res)`.
 */
export async function parseFlowdError(res: Response): Promise<FlowdError> {
  let raw: unknown
  try {
    raw = await res.json()
  } catch {
    raw = undefined
  }
  const parsed = flowdErrorSchema.safeParse(raw)
  const message = parsed.success
    ? parsed.data.error
    : res.statusText || 'flow request failed'
  return new FlowdError(res.status, message)
}

// ── base64 decode (one place — A1) ──────────────────────────────────────────

/**
 * Decode the base64 `FlowRecord.json` (Go `[]byte`) into the flow IR object.
 * Kept in ONE helper so a future verify against a live `GET /flows/{id}` only
 * touches a single decode site (A1). `btoa`/`atob` operate on latin1; round-trip
 * through TextDecoder so multi-byte UTF-8 flow text decodes correctly.
 */
export function decodeFlowJson(base64: string): unknown {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (c: string) => c.charCodeAt(0))
  const text = new TextDecoder().decode(bytes)
  return JSON.parse(text)
}

// ── Flow CRUD ───────────────────────────────────────────────────────────────

/** GET /api/flow/flows → FlowMeta[]. */
export async function listFlows(): Promise<FlowMeta[]> {
  const res = await fetch(`${FLOW_BASE}/flows`)
  if (!res.ok) throw await parseFlowdError(res)
  const body = (await res.json()) as { flows: unknown[] }
  return (body.flows ?? []).map((f) => flowMetaSchema.parse(f))
}

/** A FlowRecord with the base64 `json` decoded into a `flow` object (A1). */
export type DecodedFlowRecord = FlowRecord & { flow: unknown }

/**
 * GET /api/flow/flows/{id} → FlowRecord. Base64-decodes `json` → `flow` (the
 * decode-on-load path; the raw `json` string is preserved on the record too).
 */
export async function getFlow(id: string): Promise<DecodedFlowRecord> {
  const res = await fetch(`${FLOW_BASE}/flows/${id}`)
  if (!res.ok) throw await parseFlowdError(res)
  const rec = flowRecordSchema.parse(await res.json())
  return { ...rec, flow: decodeFlowJson(rec.json) }
}

export type FlowWriteBody = {
  /** Optional — present only on create (POST). PUT OMITS id (Pitfall 4). */
  id?: string
  name?: string
  /** RAW flow IR JSON (NOT base64). */
  flow: unknown
}

/** POST /api/flow/flows → 201 FlowRecord | 409 {error}. */
export async function createFlow(body: FlowWriteBody): Promise<FlowRecord> {
  const res = await fetch(`${FLOW_BASE}/flows`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await parseFlowdError(res)
  return flowRecordSchema.parse(await res.json())
}

/**
 * PUT /api/flow/flows/{id} → 200 FlowRecord | 400 {error}. Sends {name?, flow}
 * with the RAW flow JSON and OMITS `id` (the URL is the source of truth — flowd
 * 400s a body id ≠ URL id; Pitfall 4).
 */
export async function putFlow(
  id: string,
  flow: unknown,
  name?: string,
): Promise<FlowRecord> {
  const res = await fetch(`${FLOW_BASE}/flows/${id}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ...(name !== undefined ? { name } : {}), flow }),
  })
  if (!res.ok) throw await parseFlowdError(res)
  return flowRecordSchema.parse(await res.json())
}

/**
 * DELETE /api/flow/flows/{id} → 204 No Content. Treats 204 as success and does
 * NOT parse a body (Pitfall 5 — flowd DELETE returns no JSON).
 */
export async function deleteFlow(id: string): Promise<void> {
  const res = await fetch(`${FLOW_BASE}/flows/${id}`, { method: 'DELETE' })
  if (!res.ok) throw await parseFlowdError(res)
  // 204 No Content — do NOT res.json().
}

// ── Sync run (FLOW-03) ──────────────────────────────────────────────────────

export type RunSyncResult = {
  outputs: Record<string, string>
  run_id: string
}

/**
 * POST /api/flow/flows/{id}/run → 200 {outputs, run_id} | 4xx/5xx {error}.
 * Inputs are string→string only.
 */
export async function runSync(
  flowId: string,
  inputs: Record<string, string>,
): Promise<RunSyncResult> {
  const res = await fetch(`${FLOW_BASE}/flows/${flowId}/run`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ inputs }),
  })
  if (!res.ok) throw await parseFlowdError(res)
  return (await res.json()) as RunSyncResult
}

// ── Run history + detail + events (FLOW-05 / FLOW-06) ───────────────────────

/** GET /api/flow/flows/{id}/runs → RunMeta[]. */
export async function listRuns(flowId: string): Promise<RunMeta[]> {
  const res = await fetch(`${FLOW_BASE}/flows/${flowId}/runs`)
  if (!res.ok) throw await parseFlowdError(res)
  const body = (await res.json()) as { runs: unknown[] }
  return (body.runs ?? []).map((r) => runMetaSchema.parse(r))
}

/** GET /api/flow/runs/{id} → RunRecord | 404. */
export async function getRun(runId: string): Promise<RunRecord> {
  const res = await fetch(`${FLOW_BASE}/runs/${runId}`)
  if (!res.ok) throw await parseFlowdError(res)
  return runRecordSchema.parse(await res.json())
}

/**
 * GET /api/flow/runs/{id}/events → RunEvent[]. A 200 + `{events:[]}` is a VALID
 * empty result (an unknown/just-created run) — returns `[]`, not an error
 * (Pitfall 7). A 404 maps to "no such run" via FlowdError.
 */
export async function listRunEvents(runId: string): Promise<RunEvent[]> {
  const res = await fetch(`${FLOW_BASE}/runs/${runId}/events`)
  if (!res.ok) throw await parseFlowdError(res)
  const body = (await res.json()) as { events?: unknown[] }
  return (body.events ?? []).map((e) => runEventSchema.parse(e))
}
