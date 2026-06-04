import { vi } from 'vitest'

/**
 * flowd test mock harness — golden REST fixtures + a fetch-mock router + the
 * edge cases the Wave-0 validation plan requires.
 *
 * Fixtures mirror the VERIFIED flowd wire contract (03-RESEARCH.md "THE FLOWD
 * CONTRACT"). The flow `json` field is a Go `[]byte` → it serializes as a
 * base64 STRING (NOT inline JSON) — `flowRecordFixture.json` is therefore the
 * base64 of `flowDefinition`. The error envelope is FLAT `{ "error": "..." }`
 * (NOT the gateway's nested `{ error: { code, ... } }`).
 *
 * Edge cases included: a 400 flat compile error, a 409 duplicate, a 204 delete
 * (empty body), and an empty `/events` (200 + `{ events: [] }`).
 */

// ── Flow definition + its base64 wire encoding ──────────────────────────────

/** The decoded flow IR an operator edits. */
export const flowDefinition = {
  id: 'echo_chain',
  nodes: [{ id: 'upper', type: 'uppercase' }],
}

/**
 * The base64 of `JSON.stringify(flowDefinition)` — what flowd actually puts on
 * the wire for `FlowRecord.json` (Go `[]byte` default JSON encoding).
 */
export const flowJsonBase64 =
  typeof btoa === 'function'
    ? btoa(JSON.stringify(flowDefinition))
    : Buffer.from(JSON.stringify(flowDefinition)).toString('base64')

// ── Canonical fixtures (golden wire shapes) ─────────────────────────────────

/** A single FlowMeta = { id, name?, created_at, updated_at }. */
export const flowMetaFixture = {
  id: 'echo_chain',
  name: 'Echo Chain',
  created_at: '2026-06-03T10:00:00Z',
  updated_at: '2026-06-03T10:05:00Z',
}

/** GET /flows → { flows: [FlowMeta] }. */
export const flowsListFixture = {
  flows: [
    flowMetaFixture,
    {
      id: 'router_flow',
      name: 'Router Flow',
      created_at: '2026-06-03T09:00:00Z',
      updated_at: '2026-06-03T09:01:00Z',
    },
  ],
}

/** GET /flows/{id} → FlowRecord = FlowMeta + { json: <base64> }. */
export const flowRecordFixture = {
  ...flowMetaFixture,
  json: flowJsonBase64,
}

/** A single RunMeta = { id, flow_id, status, started_at, finished_at? }. */
export const runMetaFixture = {
  id: 'run_abc',
  flow_id: 'echo_chain',
  status: 'done',
  started_at: '2026-06-03T10:00:00Z',
  finished_at: '2026-06-03T10:00:02Z',
}

/** GET /flows/{id}/runs → { runs: [RunMeta] }. */
export const runsListFixture = {
  runs: [
    runMetaFixture,
    {
      id: 'run_def',
      flow_id: 'echo_chain',
      status: 'running',
      started_at: '2026-06-03T10:10:00Z',
    },
  ],
}

/** GET /runs/{id} → RunRecord = RunMeta + { inputs?, outputs?, error? }. */
export const runRecordFixture = {
  ...runMetaFixture,
  inputs: { in: 'hello' },
  outputs: { out: 'OLLEH' },
}

/** GET /runs/{id}/events → { events: [RunEvent] }. seq lives ONLY here. */
export const runEventsFixture = {
  events: [
    {
      seq: 1,
      kind: 'flow_started',
      payload: { flow: 'echo_chain' },
      ts: '2026-06-03T10:00:00Z',
    },
    {
      seq: 2,
      kind: 'node_started',
      node_id: 'upper',
      payload: { node: 'upper', input: { in: 'hello' } },
      ts: '2026-06-03T10:00:01Z',
    },
    {
      seq: 3,
      kind: 'node_finished',
      node_id: 'upper',
      payload: { node: 'upper', output: { out: 'OLLEH' } },
      ts: '2026-06-03T10:00:01Z',
    },
    {
      seq: 4,
      kind: 'flow_done',
      payload: { flow: 'echo_chain', outputs: { out: 'OLLEH' } },
      ts: '2026-06-03T10:00:02Z',
    },
  ],
}

/** The valid-but-empty events case (200 + { events: [] }) — NOT an error. */
export const runEventsEmpty = { events: [] as never[] }

/** POST /flows/{id}/run → { outputs, run_id }. X-Run-ID header also set. */
export const runSyncResponse = {
  outputs: { out: 'OLLEH' },
  run_id: 'run_sync_1',
}

// ── Edge-case error fixtures (FLAT envelope) ────────────────────────────────

/** 400 — flowd compile error (flat string). */
export const flowdError400 = { error: 'flow compile: node "upper": unknown type' }

/** 409 — duplicate id on create. */
export const flowdError409 = { error: 'flow "echo_chain" already exists' }

/** 404 — unknown flow/run. */
export const flowdError404 = { error: 'flow "missing" not found' }

/** 500 — generic run failure (flat). */
export const flowdError500 = { error: 'missing required input: in' }

// ── fetch-mock harness ──────────────────────────────────────────────────────

export type FlowdMockRoute = {
  /** HTTP method to match (case-insensitive). */
  method: string
  /** Path matcher — exact string (origin/query stripped) or RegExp. */
  path: string | RegExp
  /** HTTP status to return (default 200). */
  status?: number
  /**
   * JSON body to return. Omit for a 204 / empty-body response (the harness then
   * returns a real empty-body Response so `res.json()` is never called).
   */
  body?: unknown
  /** Response headers to attach (e.g. X-Run-ID on /run). */
  headers?: Record<string, string>
}

/**
 * Stub global fetch with a method+path router over the supplied routes.
 *
 * Each route returns a real `Response` so the client's `res.ok` / `res.json()`
 * / `parseFlowdError` / 204-no-body paths execute exactly as in production. A
 * route with no `body` yields a genuinely empty-body Response (status default
 * 204) so the DELETE-no-parse path is exercised. Returns the `vi.fn` spy + a
 * `restore()`. Unmatched requests throw so missing routes fail loudly.
 */
export function installFlowdFetchMock(routes: FlowdMockRoute[]) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url
      // Strip origin + query so route paths match same-origin "/api/flow/...".
      const path = rawUrl.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
      const method = (
        init?.method ??
        (typeof input === 'object' && 'method' in input
          ? (input as Request).method
          : 'GET')
      ).toUpperCase()

      const route = routes.find((r) => {
        if (r.method.toUpperCase() !== method) return false
        return typeof r.path === 'string' ? r.path === path : r.path.test(path)
      })

      if (!route) {
        throw new Error(`installFlowdFetchMock: no route for ${method} ${path}`)
      }

      const headers: Record<string, string> = { ...route.headers }
      const hasBody = route.body !== undefined
      if (hasBody) headers['Content-Type'] = 'application/json'

      return new Response(hasBody ? JSON.stringify(route.body) : null, {
        status: route.status ?? (hasBody ? 200 : 204),
        headers,
      })
    },
  )

  vi.stubGlobal('fetch', fetchMock)

  return {
    fetchMock,
    restore: () => vi.unstubAllGlobals(),
  }
}
