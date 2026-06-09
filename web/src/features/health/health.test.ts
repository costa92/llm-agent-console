/**
 * Tests for useServiceHealth (SHELL-02 / D-02).
 *
 * Scenarios:
 *  1. Successful /api/health response → correct status mapping per service.
 *  2. isPending (pre-first-poll) → all services return 'unknown', no lastChecked.
 *  3. isError (poll itself failed) → status 'unknown', lastChecked retained from
 *     last successful data (stale-on-self-failure / D-02).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useServiceHealth, type HealthDTO } from './useServiceHealth'

// ---- Fetch mock helpers ----

const fetchMock = vi.fn()

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as typeof fetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** A healthy DTO where all three services are "up". */
const allUpDto: HealthDTO = {
  services: {
    memory: { status: 'up', lastChecked: '2026-06-09T10:00:00Z', latencyMs: 12 },
    flow: { status: 'up', lastChecked: '2026-06-09T10:00:00Z', latencyMs: 8 },
    chat: { status: 'up', lastChecked: '2026-06-09T10:00:00Z', latencyMs: 15 },
  },
}

/** A DTO with mixed statuses (up/degraded/down). */
const mixedDto: HealthDTO = {
  services: {
    memory: { status: 'degraded', lastChecked: '2026-06-09T10:01:00Z', latencyMs: 1400 },
    flow: { status: 'up', lastChecked: '2026-06-09T10:01:00Z', latencyMs: 20 },
    chat: { status: 'down', lastChecked: '2026-06-09T10:01:00Z' },
  },
}

function mockOkResponse(dto: HealthDTO) {
  // Use mockImplementation (not mockResolvedValue) so each call gets a FRESH
  // Response object. A Response body is a stream — reusing the same instance
  // across two calls makes the second res.json() fail with a "body used" error.
  fetchMock.mockImplementation(
    (): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify(dto), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
  )
}

function mockErrorResponse(status = 503) {
  fetchMock.mockImplementation(
    (): Promise<Response> =>
      Promise.resolve(new Response('Service Unavailable', { status })),
  )
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // Disable automatic background refetching so tests stay deterministic.
        refetchOnWindowFocus: false,
        refetchIntervalInBackground: false,
        // Disable the interval refetch entirely in tests — we'll trigger
        // refetches explicitly via result.current.q.refetch().
        refetchInterval: false,
      },
    },
  })
  return function wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children)
  }
}

// ---- Tests ----

describe('useServiceHealth — success mapping', () => {
  it('maps up/degraded/down correctly from the DTO', async () => {
    mockOkResponse(mixedDto)

    const { result } = renderHook(() => useServiceHealth(), { wrapper: makeWrapper() })

    // Assert inside waitFor so all three checks happen in the SAME render snapshot.
    await waitFor(() => {
      expect(result.current.getService('flow').status).toBe('up')
      expect(result.current.getService('memory').status).toBe('degraded')
      expect(result.current.getService('chat').status).toBe('down')
    })
  })

  it('exposes lastChecked and latencyMs on success', async () => {
    mockOkResponse(allUpDto)

    const { result } = renderHook(() => useServiceHealth(), { wrapper: makeWrapper() })

    await waitFor(() => {
      const mem = result.current.getService('memory')
      expect(mem.lastChecked).toBe('2026-06-09T10:00:00Z')
      expect(mem.latencyMs).toBe(12)
    })
  })
})

describe('useServiceHealth — isPending (pre-first-poll)', () => {
  it('returns status unknown for all services before first fetch resolves', () => {
    // fetchMock never resolves — hook stays in pending state.
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}))

    const { result } = renderHook(() => useServiceHealth(), { wrapper: makeWrapper() })

    // isPending is synchronously true before the first response.
    expect(result.current.q.isPending).toBe(true)
    expect(result.current.getService('memory').status).toBe('unknown')
    expect(result.current.getService('flow').status).toBe('unknown')
    expect(result.current.getService('chat').status).toBe('unknown')
    expect(result.current.getService('memory').lastChecked).toBeUndefined()
  })
})

describe('useServiceHealth — stale-on-self-failure (D-02)', () => {
  it('status becomes unknown but retains lastChecked from last success on poll error', async () => {
    // First call succeeds.
    mockOkResponse(allUpDto)

    const { result } = renderHook(() => useServiceHealth(), { wrapper: makeWrapper() })
    await waitFor(() => {
      const flow = result.current.getService('flow')
      expect(flow.status).toBe('up')
      expect(flow.lastChecked).toBe('2026-06-09T10:00:00Z')
    })

    // Second call fails — the hook should retain the previous data.
    mockErrorResponse(503)

    // Force a refetch.
    await result.current.q.refetch().catch(() => {})

    await waitFor(() => result.current.q.isError)

    const flow = result.current.getService('flow')
    expect(flow.status).toBe('unknown')
    // lastChecked from the last successful data is preserved.
    expect(flow.lastChecked).toBe('2026-06-09T10:00:00Z')
  })

  it('returns unknown without lastChecked when no prior success exists', async () => {
    mockErrorResponse(503)

    const { result } = renderHook(() => useServiceHealth(), { wrapper: makeWrapper() })
    await waitFor(() => result.current.q.isError)

    const chat = result.current.getService('chat')
    expect(chat.status).toBe('unknown')
    expect(chat.lastChecked).toBeUndefined()
  })
})
