import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'

import { OperatorContextProvider } from '@/app/OperatorContextProvider'
import {
  installMemoryFetchMock,
  itemFixture,
  patchResponse,
  writeResponse,
  conflict409,
  type MockRoute,
} from '@/test/mocks/memory-gateway'
import { useWriteMutation, usePatchMutation } from './useMemoryMutations'

const ITEM_PATH = '/api/memory/items/mem_123'
const WRITE_PATH = '/api/memory/write'

/** A 400 content-required envelope (the generic red-failure path, NOT 409). */
const contentRequired400 = {
  error: {
    code: 'invalid_argument',
    message: 'content is required',
    request_id: 'req_400',
    retryable: false,
    details: {},
  },
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return createElement(
    OperatorContextProvider,
    null,
    createElement(QueryClientProvider, { client: queryClient }, children),
  )
}

function install(routes: MockRoute[]) {
  return installMemoryFetchMock(routes)
}

function itemGetCalls(fetchMock: ReturnType<typeof install>['fetchMock']) {
  return fetchMock.mock.calls.filter((c) => {
    const url = String(c[0])
    const method = (c[1]?.method ?? 'GET').toUpperCase()
    return method === 'GET' && url.includes('/items/mem_123')
  })
}

function recallCalls(fetchMock: ReturnType<typeof install>['fetchMock']) {
  return fetchMock.mock.calls.filter((c) =>
    String(c[0]).includes('/recall/unified'),
  )
}

describe('useMemoryMutations — write/patch + refetch-after + 409 + partial (D-09/IC-5)', () => {
  beforeEach(() => {
    localStorage.setItem(
      'operator-context',
      JSON.stringify({ tenantId: 'acme', userId: 'u-1', projectId: '', sessionId: '' }),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('patch sends expected_version on the PATCH body (OCC threading)', async () => {
    const { fetchMock } = install([
      { method: 'PATCH', path: ITEM_PATH, body: patchResponse },
      { method: 'GET', path: ITEM_PATH, body: itemFixture },
    ])
    const { result } = renderHook(() => usePatchMutation(), { wrapper })

    result.current.mutate({ id: 'mem_123', patch: { content: 'y' }, expected_version: 7 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const patchCall = fetchMock.mock.calls.find(
      (c) => (c[1]?.method ?? '').toUpperCase() === 'PATCH',
    )
    expect(patchCall).toBeTruthy()
    const sentBody = JSON.parse(String(patchCall![1]!.body))
    expect(sentBody.expected_version).toBe(7)
  })

  it('patch refetches GET item after success (D-09 — does not trust the lean response)', async () => {
    const { fetchMock } = install([
      { method: 'PATCH', path: ITEM_PATH, body: patchResponse },
      { method: 'GET', path: ITEM_PATH, body: itemFixture },
    ])
    const { result } = renderHook(() => usePatchMutation(), { wrapper })

    result.current.mutate({ id: 'mem_123', patch: { content: 'y' }, expected_version: 7 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    await waitFor(() => expect(itemGetCalls(fetchMock).length).toBeGreaterThanOrEqual(1))
  })

  it('does NOT auto re-run recall on patch success (no auto re-search, D-09)', async () => {
    const { fetchMock } = install([
      { method: 'PATCH', path: ITEM_PATH, body: patchResponse },
      { method: 'GET', path: ITEM_PATH, body: itemFixture },
    ])
    const { result } = renderHook(() => usePatchMutation(), { wrapper })

    result.current.mutate({ id: 'mem_123', patch: { content: 'y' }, expected_version: 7 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    await waitFor(() => expect(itemGetCalls(fetchMock).length).toBeGreaterThanOrEqual(1))
    expect(recallCalls(fetchMock)).toHaveLength(0)
  })

  it('write success fires "Record written." and exposes the new memory_id', async () => {
    const successSpy = vi.spyOn(toast, 'success')
    const { fetchMock } = install([
      { method: 'POST', path: WRITE_PATH, body: writeResponse },
      { method: 'GET', path: ITEM_PATH, body: itemFixture },
    ])
    const { result } = renderHook(() => useWriteMutation(), { wrapper })

    result.current.mutate({ kind: 'semantic', content: 'hello' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(successSpy).toHaveBeenCalledWith('Record written.')
    expect(result.current.data?.memory.memory_id).toBe('mem_123')
    // No recall row inserted / no re-recall.
    expect(recallCalls(fetchMock)).toHaveLength(0)
  })

  it('patch success fires "Patched."', async () => {
    const successSpy = vi.spyOn(toast, 'success')
    install([
      { method: 'PATCH', path: ITEM_PATH, body: patchResponse },
      { method: 'GET', path: ITEM_PATH, body: itemFixture },
    ])
    const { result } = renderHook(() => usePatchMutation(), { wrapper })

    result.current.mutate({ id: 'mem_123', patch: { content: 'y' }, expected_version: 7 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(successSpy).toHaveBeenCalledWith('Patched.')
  })

  it('PARTIAL on refetch-after fail: 200 patch but 503 GET item → success toast + partial set + NO red failure', async () => {
    const successSpy = vi.spyOn(toast, 'success')
    const errorSpy = vi.spyOn(toast, 'error')
    // PATCH returns 200; the follow-up GET item returns 503 (refetch fails).
    install([
      { method: 'PATCH', path: ITEM_PATH, body: patchResponse },
      {
        method: 'GET',
        path: ITEM_PATH,
        status: 503,
        body: {
          error: {
            code: 'unavailable',
            message: 'gateway unavailable',
            request_id: 'req_503',
            retryable: true,
            details: {},
          },
        },
      },
    ])

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const localWrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        OperatorContextProvider,
        null,
        createElement(QueryClientProvider, { client: queryClient }, children),
      )

    const { result } = renderHook(() => usePatchMutation(), { wrapper: localWrapper })

    result.current.mutate({ id: 'mem_123', patch: { content: 'y' }, expected_version: 7 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // The mutation success toast still fired (the change DID land).
    expect(successSpy).toHaveBeenCalledWith('Patched.')
    // The partial signal is set in the cache for the drawer to render.
    await waitFor(() => {
      const partial = queryClient.getQueryData(['memory-item-partial', 'mem_123'])
      expect(partial).toMatchObject({
        message: expect.stringContaining("couldn't refresh the item body"),
      })
    })
    // NO generic red "Patch failed" toast was fired for the refetch failure.
    const redFailureFired = errorSpy.mock.calls.some((c) =>
      String(c[0]).includes('Patch failed'),
    )
    expect(redFailureFired).toBe(false)
  })

  it('409 first-class (IC-5): memory_conflict → amber "the item changed" toast + auto-refetch GET item, NOT the red failure', async () => {
    const errorSpy = vi.spyOn(toast, 'error')
    const { fetchMock } = install([
      { method: 'PATCH', path: ITEM_PATH, status: 409, body: conflict409 },
      { method: 'GET', path: ITEM_PATH, body: itemFixture },
    ])
    const { result } = renderHook(() => usePatchMutation(), { wrapper })

    result.current.mutate({ id: 'mem_123', patch: { content: 'y' }, expected_version: 4 })
    await waitFor(() => expect(result.current.isError).toBe(true))

    // Amber 409 recovery toast (NOT the generic "Patch failed — 4xx" red path).
    await waitFor(() =>
      expect(
        errorSpy.mock.calls.some((c) =>
          String(c[0]).includes('the item changed'),
        ),
      ).toBe(true),
    )
    // Auto-refetched GET item to load the fresh version.
    await waitFor(() => expect(itemGetCalls(fetchMock).length).toBeGreaterThanOrEqual(1))
  })

  it('generic failure (SHELL-06): a non-409 PATCH failure (400) fires the red "Patch failed — 400: ..." toast, not the 409/partial path', async () => {
    const errorSpy = vi.spyOn(toast, 'error')
    install([
      { method: 'PATCH', path: ITEM_PATH, status: 400, body: contentRequired400 },
      { method: 'GET', path: ITEM_PATH, body: itemFixture },
    ])
    const { result } = renderHook(() => usePatchMutation(), { wrapper })

    result.current.mutate({ id: 'mem_123', patch: { content: '' }, expected_version: 7 })
    await waitFor(() => expect(result.current.isError).toBe(true))

    await waitFor(() =>
      expect(
        errorSpy.mock.calls.some((c) =>
          String(c[0]).includes('Patch failed — 400: content is required'),
        ),
      ).toBe(true),
    )
    // Not the amber 409 path.
    const amberFired = errorSpy.mock.calls.some((c) =>
      String(c[0]).includes('the item changed'),
    )
    expect(amberFired).toBe(false)
  })
})
