import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  OperatorContextProvider,
  useOperatorContext,
} from '@/app/OperatorContextProvider'
import { makeApiFetcher } from '@/lib/api'

const STORAGE_KEY = 'operator-context'

function wrapper({ children }: { children: ReactNode }) {
  return <OperatorContextProvider>{children}</OperatorContextProvider>
}

describe('OperatorContextProvider', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('initializes from localStorage on mount', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tenantId: 'acme',
        userId: 'u-1',
        projectId: 'p-1',
        sessionId: 's-1',
      }),
    )
    const { result } = renderHook(() => useOperatorContext(), { wrapper })
    expect(result.current.tenantId).toBe('acme')
    expect(result.current.userId).toBe('u-1')
    expect(result.current.projectId).toBe('p-1')
    expect(result.current.sessionId).toBe('s-1')
  })

  it('updating tenantId via setContext writes to localStorage and re-provides via context', () => {
    const { result } = renderHook(() => useOperatorContext(), { wrapper })
    act(() => {
      result.current.setContext({ tenantId: 'beta' })
    })
    expect(result.current.tenantId).toBe('beta')
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(persisted.tenantId).toBe('beta')
  })

  it('on mount with empty localStorage, context has tenantId and userId empty', () => {
    const { result } = renderHook(() => useOperatorContext(), { wrapper })
    expect(result.current.tenantId).toBe('')
    expect(result.current.userId).toBe('')
  })
})

describe('makeApiFetcher header injection', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const base = {
    projectId: '',
    sessionId: '',
    setContext: () => {},
  }

  it('sets X-Console-Tenant when tenantId is non-empty; not when empty', async () => {
    const withTenant = makeApiFetcher({ ...base, tenantId: 'acme', userId: '' })
    await withTenant('/api/memory')
    let headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Headers
    expect(headers.get('X-Console-Tenant')).toBe('acme')

    fetchSpy.mockClear()
    const noTenant = makeApiFetcher({ ...base, tenantId: '', userId: '' })
    await noTenant('/api/memory')
    headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Headers
    expect(headers.get('X-Console-Tenant')).toBeNull()
  })

  it('sets X-Console-User when userId is non-empty', async () => {
    const fetcher = makeApiFetcher({ ...base, tenantId: '', userId: 'u-9' })
    await fetcher('/api/memory')
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Headers
    expect(headers.get('X-Console-User')).toBe('u-9')
  })

  it('does NOT add an Authorization header', async () => {
    const fetcher = makeApiFetcher({ ...base, tenantId: 'acme', userId: 'u-9' })
    await fetcher('/api/memory')
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Headers
    expect(headers.get('Authorization')).toBeNull()
  })
})
