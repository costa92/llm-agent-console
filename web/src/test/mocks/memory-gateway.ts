import { vi } from 'vitest'

/**
 * Memory-gateway test mock harness.
 *
 * Canonical fixtures are copied verbatim from the gateway's golden wire JSON
 * (`../llm-agent-memory-gateway/internal/httpapi/testdata/wire/*.json`) so the
 * console's schemas + client are tested against the REAL contract, not guesses.
 * Reusable by every later memory slice (recall→render, drawer, lifecycle).
 *
 * Includes the two contract edge cases the validation plan requires:
 *   - recallEmpty: an empty-hits ({ hits: [] }) 200 → drives the empty state
 *   - conflict409: a 409 memory_conflict envelope → drives OCC recovery
 */

// ── Canonical fixtures (golden wire shapes) ────────────────────────────────

/** recall_unified_response.json — a non-empty ranked result set. */
export const recallNonEmpty = {
  hits: [
    {
      memory_id: 'mem_123',
      kind: 'semantic',
      score: 0.95,
      version: 7,
      content: 'User prefers concise technical answers.',
      tags: ['preference', 'style'],
      source: 'user_saved',
      category: 'profile',
      pinned: true,
      disabled: false,
      metadata: {
        matched_by: 'long_term_unified',
        token_cost_estimate: 42,
      },
    },
  ],
  trace: {
    cache_level: 'l1',
    consistency_level: 'eventual',
    memory_token_budget: 400,
    returned_token_estimate: 42,
    stale_served: true,
  },
}

/** The valid-but-zero-results case ({ hits: [] }) — a 200, NOT an error. */
export const recallEmpty = { hits: [] as never[] }

/** get_memory_item_response.json — the canonical full item. */
export const itemFixture = {
  memory_id: 'mem_123',
  kind: 'semantic',
  version: 7,
  content: 'User prefers concise technical answers.',
  tags: ['preference', 'style'],
  source: 'user_saved',
  category: 'profile',
  importance: 0.95,
  pinned: true,
  disabled: false,
}

/** pin_memory_response.json — flag echoed + new version. */
export const pinResponse = { memory_id: 'mem_123', version: 8, pinned: true }

/** unpin echoes the same shape with pinned:false. */
export const unpinResponse = { memory_id: 'mem_123', version: 8, pinned: false }

/** disable_memory_response.json — flag echoed + new version. */
export const disableResponse = {
  memory_id: 'mem_123',
  version: 8,
  disabled: true,
}

/** enable echoes the same shape with disabled:false. */
export const enableResponse = {
  memory_id: 'mem_123',
  version: 8,
  disabled: false,
}

/** patch_memory_response.json — lean: { memory_id, version } only. */
export const patchResponse = { memory_id: 'mem_123', version: 10 }

/** write_memory_response.json — lean nested { memory: { ... } }. */
export const writeResponse = {
  memory: { memory_id: 'mem_123', status: 'created', version: 7 },
}

/** delete_memory_response.json — { memory_id, deleted, version }. */
export const deleteResponse = {
  memory_id: 'mem_123',
  deleted: true,
  version: 10,
}

/** error_response.json — the golden 409 memory_conflict envelope (OCC). */
export const conflict409 = {
  error: {
    code: 'memory_conflict',
    message: 'expected_version does not match current version',
    request_id: 'req_123',
    retryable: false,
    details: {
      memory_id: 'mem_123',
      expected_version: 4,
      current_version: 5,
    },
  },
}

// ── fetch-mock harness ──────────────────────────────────────────────────────

export type MockRoute = {
  /** HTTP method to match (case-insensitive). */
  method: string
  /**
   * Path matcher: a string (matched against the request path, ignoring the
   * origin/query) or a RegExp tested against the full path.
   */
  path: string | RegExp
  /** HTTP status to return (default 200). */
  status?: number
  /** JSON body to return. */
  body: unknown
}

/**
 * Stub global fetch with a method+path router over the supplied routes.
 *
 * Each route returns a real `Response` (status + JSON body) so the client's
 * `res.ok` / `res.json()` / `parseGatewayError` paths execute exactly as in
 * production. Returns the `vi.fn` spy so tests can assert call count/args, plus
 * a `restore()` to unstub. Unmatched requests reject so missing routes fail
 * loudly rather than hanging.
 */
export function installMemoryFetchMock(routes: MockRoute[]) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url
      // Strip origin + query so route paths match same-origin "/api/memory/...".
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
        throw new Error(`installMemoryFetchMock: no route for ${method} ${path}`)
      }

      return new Response(JSON.stringify(route.body), {
        status: route.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  )

  vi.stubGlobal('fetch', fetchMock)

  return {
    fetchMock,
    restore: () => vi.unstubAllGlobals(),
  }
}
