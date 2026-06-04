import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'

import { OperatorContextProvider } from '@/app/OperatorContextProvider'
import {
  installMemoryFetchMock,
  itemFixture,
  pinResponse,
  unpinResponse,
  disableResponse,
  enableResponse,
  deleteResponse,
  conflict409,
  type MockRoute,
} from '@/test/mocks/memory-gateway'
import { memoryKeys } from '../api/queries'
import {
  usePinMutation,
  useUnpinMutation,
  useDisableMutation,
  useEnableMutation,
  useDeleteMutation,
} from './useMemoryMutations'

const ID = 'mem_123'
const PIN_PATH = '/api/memory/items/mem_123/pin'
const UNPIN_PATH = '/api/memory/items/mem_123/unpin'
const DISABLE_PATH = '/api/memory/items/mem_123/disable'
const ENABLE_PATH = '/api/memory/items/mem_123/enable'
const ITEM_PATH = '/api/memory/items/mem_123'

/** A non-409 failure (400 expected_version required) — the generic red path. */
const versionRequired400 = {
  error: {
    code: 'invalid_argument',
    message: 'expected_version is required',
    request_id: 'req_400',
    retryable: false,
    details: {},
  },
}

/**
 * A QueryClient + recall/item caches seeded with the item BEFORE the action so
 * we can assert the post-success cache state (reflect / splice). Returns both
 * the client and a wrapper bound to it.
 */
function makeSeeded() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  // Seed the item cache (drawer body) at version 7, pinned/enabled.
  queryClient.setQueryData(memoryKeys.item(ID), { ...itemFixture })
  // Seed a recall query (results table) holding the same hit.
  queryClient.setQueryData(['recall', { query: 'x', top_k: 8 }], {
    hits: [
      {
        memory_id: ID,
        kind: 'semantic',
        score: 0.95,
        version: 7,
        content: 'x',
        pinned: true,
        disabled: false,
      },
    ],
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      OperatorContextProvider,
      null,
      createElement(QueryClientProvider, { client: queryClient }, children),
    )
  return { queryClient, wrapper }
}

function install(routes: MockRoute[]) {
  return installMemoryFetchMock(routes)
}

function getItemCalls(fetchMock: ReturnType<typeof install>['fetchMock']) {
  return fetchMock.mock.calls.filter((c) => {
    const url = String(c[0])
    const method = (c[1]?.method ?? 'GET').toUpperCase()
    return method === 'GET' && /\/items\/mem_123$/.test(url.split('?')[0])
  })
}

function recallCalls(fetchMock: ReturnType<typeof install>['fetchMock']) {
  return fetchMock.mock.calls.filter((c) =>
    String(c[0]).includes('/recall/unified'),
  )
}

function cachedItem(queryClient: QueryClient) {
  return queryClient.getQueryData(memoryKeys.item(ID)) as
    | (Record<string, unknown> & { version: number })
    | undefined
}

function cachedHits(queryClient: QueryClient) {
  const recall = queryClient.getQueryData(['recall', { query: 'x', top_k: 8 }]) as
    | { hits: Array<Record<string, unknown> & { memory_id: string; version: number }> }
    | undefined
  return recall?.hits ?? []
}

describe('useLifecycleMutations — reflect-from-response / splice / OCC / 409 (D-09/D-11/IC-5)', () => {
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

  it('pin sends expected_version on the POST body (OCC threading)', async () => {
    const { fetchMock } = install([{ method: 'POST', path: PIN_PATH, body: pinResponse }])
    const { wrapper } = makeSeeded()
    const { result } = renderHook(() => usePinMutation(), { wrapper })

    result.current.mutate({ id: ID, expected_version: 7 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const pinCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).endsWith('/pin'),
    )
    expect(pinCall).toBeTruthy()
    const sentBody = JSON.parse(String(pinCall![1]!.body))
    expect(sentBody.expected_version).toBe(7)
  })

  it('pin reflect-from-response (D-09): merges {pinned,version} onto item + recall hit, NO GET refetch, NO re-recall', async () => {
    const { fetchMock } = install([{ method: 'POST', path: PIN_PATH, body: pinResponse }])
    const { queryClient, wrapper } = makeSeeded()
    const { result } = renderHook(() => usePinMutation(), { wrapper })

    result.current.mutate({ id: ID, expected_version: 7 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // Item cache merged the echoed flag + version (no refetch needed).
    expect(cachedItem(queryClient)).toMatchObject({ pinned: true, version: 8 })
    // Recall hit merged the same.
    expect(cachedHits(queryClient)[0]).toMatchObject({ pinned: true, version: 8 })
    // Reflect-from-response means NO GET item refetch and NO re-run recall.
    expect(getItemCalls(fetchMock)).toHaveLength(0)
    expect(recallCalls(fetchMock)).toHaveLength(0)
  })

  it('disable reflect: merges {disabled,version} onto the cached item/hit', async () => {
    install([{ method: 'POST', path: DISABLE_PATH, body: disableResponse }])
    const { queryClient, wrapper } = makeSeeded()
    const { result } = renderHook(() => useDisableMutation(), { wrapper })

    result.current.mutate({ id: ID, expected_version: 7 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(cachedItem(queryClient)).toMatchObject({ disabled: true, version: 8 })
    expect(cachedHits(queryClient)[0]).toMatchObject({ disabled: true, version: 8 })
  })

  it('delete splice (D-09): removes the hit from the cached recall data; recall is NOT re-run', async () => {
    const { fetchMock } = install([{ method: 'DELETE', path: ITEM_PATH, body: deleteResponse }])
    const { queryClient, wrapper } = makeSeeded()
    const { result } = renderHook(() => useDeleteMutation(), { wrapper })

    expect(cachedHits(queryClient)).toHaveLength(1)
    result.current.mutate({ id: ID, expected_version: 7 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // The row was spliced out of the cached recall data.
    expect(cachedHits(queryClient)).toHaveLength(0)
    // Recall is NOT re-run.
    expect(recallCalls(fetchMock)).toHaveLength(0)
  })

  it('version replace: after a successful pin the cached item version is the response version (fresh expected_version next)', async () => {
    install([{ method: 'POST', path: PIN_PATH, body: pinResponse }])
    const { queryClient, wrapper } = makeSeeded()
    const { result } = renderHook(() => usePinMutation(), { wrapper })

    expect(cachedItem(queryClient)?.version).toBe(7)
    result.current.mutate({ id: ID, expected_version: 7 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // The next action would thread version 8 (the response's new version).
    expect(cachedItem(queryClient)?.version).toBe(8)
  })

  it('409 reuse (IC-5): a memory_conflict invokes handle409Conflict (amber + GET item refetch), NOT the generic red toast', async () => {
    const errorSpy = vi.spyOn(toast, 'error')
    const { fetchMock } = install([
      { method: 'POST', path: PIN_PATH, status: 409, body: conflict409 },
      { method: 'GET', path: ITEM_PATH, body: itemFixture },
    ])
    const { wrapper } = makeSeeded()
    const { result } = renderHook(() => usePinMutation(), { wrapper })

    result.current.mutate({ id: ID, expected_version: 4 })
    await waitFor(() => expect(result.current.isError).toBe(true))

    // Amber 409 recovery toast (not the generic "Pin failed — 4xx" red path).
    await waitFor(() =>
      expect(
        errorSpy.mock.calls.some((c) => String(c[0]).includes('the item changed')),
      ).toBe(true),
    )
    // handle409Conflict auto-refetched GET item to load the fresh version.
    await waitFor(() => expect(getItemCalls(fetchMock).length).toBeGreaterThanOrEqual(1))
    // It was NOT the generic red failure toast (a non-409 status code). The
    // amber recovery toast legitimately reads "Pin failed — 409: the item
    // changed…"; the generic path would be a non-409 status with no "the item
    // changed" copy.
    const genericRedFired = errorSpy.mock.calls.some((c) => {
      const text = String(c[0])
      return /Pin failed — \d/.test(text) && !text.includes('the item changed')
    })
    expect(genericRedFired).toBe(false)
  })

  it('success toasts: pin→Pinned. / unpin→Unpinned. / disable→Disabled. / enable→Enabled. / delete→Deleted.', async () => {
    const successSpy = vi.spyOn(toast, 'success')
    install([
      { method: 'POST', path: PIN_PATH, body: pinResponse },
      { method: 'POST', path: UNPIN_PATH, body: unpinResponse },
      { method: 'POST', path: DISABLE_PATH, body: disableResponse },
      { method: 'POST', path: ENABLE_PATH, body: enableResponse },
      { method: 'DELETE', path: ITEM_PATH, body: deleteResponse },
    ])
    const { wrapper } = makeSeeded()

    const pinH = renderHook(() => usePinMutation(), { wrapper })
    pinH.result.current.mutate({ id: ID, expected_version: 7 })
    await waitFor(() => expect(pinH.result.current.isSuccess).toBe(true))
    expect(successSpy).toHaveBeenCalledWith('Pinned.')

    const unpinH = renderHook(() => useUnpinMutation(), { wrapper })
    unpinH.result.current.mutate({ id: ID, expected_version: 7 })
    await waitFor(() => expect(unpinH.result.current.isSuccess).toBe(true))
    expect(successSpy).toHaveBeenCalledWith('Unpinned.')

    const disableH = renderHook(() => useDisableMutation(), { wrapper })
    disableH.result.current.mutate({ id: ID, expected_version: 7 })
    await waitFor(() => expect(disableH.result.current.isSuccess).toBe(true))
    expect(successSpy).toHaveBeenCalledWith('Disabled.')

    const enableH = renderHook(() => useEnableMutation(), { wrapper })
    enableH.result.current.mutate({ id: ID, expected_version: 7 })
    await waitFor(() => expect(enableH.result.current.isSuccess).toBe(true))
    expect(successSpy).toHaveBeenCalledWith('Enabled.')

    const delH = renderHook(() => useDeleteMutation(), { wrapper })
    delH.result.current.mutate({ id: ID, expected_version: 7 })
    await waitFor(() => expect(delH.result.current.isSuccess).toBe(true))
    expect(successSpy).toHaveBeenCalledWith('Deleted.')
  })

  it('generic failure: a non-409 (400 expected_version required) pin fires "Pin failed — 400: ..." (red), not the amber 409 path', async () => {
    const errorSpy = vi.spyOn(toast, 'error')
    install([{ method: 'POST', path: PIN_PATH, status: 400, body: versionRequired400 }])
    const { wrapper } = makeSeeded()
    const { result } = renderHook(() => usePinMutation(), { wrapper })

    result.current.mutate({ id: ID, expected_version: 0 })
    await waitFor(() => expect(result.current.isError).toBe(true))

    await waitFor(() =>
      expect(
        errorSpy.mock.calls.some((c) =>
          String(c[0]).includes('Pin failed — 400: expected_version is required'),
        ),
      ).toBe(true),
    )
    const amberFired = errorSpy.mock.calls.some((c) =>
      String(c[0]).includes('the item changed'),
    )
    expect(amberFired).toBe(false)
  })
})
