import { describe, it, expect, vi } from 'vitest'
import {
  MEMORY_BASE,
  recall,
  getItem,
  write,
  patch,
  pin,
  unpin,
  disable,
  enable,
  del,
  parseGatewayError,
} from './client'
import { memoryKeys } from './queries'
import {
  recallNonEmpty,
  recallEmpty,
  itemFixture,
  pinResponse,
  patchResponse,
  writeResponse,
  deleteResponse,
  conflict409,
} from '@/test/mocks/memory-gateway'

/**
 * A recording fake apiFetch: captures {path, method, body, headers} of each
 * call and returns a configurable Response. Stands in for the Phase-1
 * makeApiFetcher result so we can assert the request shape the client builds.
 */
type Call = {
  path: string
  method: string
  body: unknown
  headers: Headers
}

function makeFakeFetch(response: { status?: number; body: unknown }) {
  const calls: Call[] = []
  const apiFetch = vi.fn(async (path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({
      path,
      method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      headers,
    })
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  return { apiFetch, calls }
}

describe('MEMORY_BASE', () => {
  it('is the Phase-1 BFF prefix /api/memory', () => {
    expect(MEMORY_BASE).toBe('/api/memory')
  })
})

describe('recall', () => {
  it('POSTs /api/memory/recall/unified with {scope:{}, query, top_k} and Content-Type json; no sort/offset/page/cursor', async () => {
    const { apiFetch, calls } = makeFakeFetch({ body: recallNonEmpty })
    const result = await recall(apiFetch, { query: 'x', top_k: 8 })

    expect(calls).toHaveLength(1)
    const c = calls[0]
    expect(c.path).toBe('/api/memory/recall/unified')
    expect(c.method).toBe('POST')
    expect(c.headers.get('Content-Type')).toBe('application/json')
    expect(c.body).toMatchObject({ scope: {}, query: 'x', top_k: 8 })

    const keys = Object.keys(c.body as Record<string, unknown>)
    expect(keys).not.toContain('sort')
    expect(keys).not.toContain('offset')
    expect(keys).not.toContain('page')
    expect(keys).not.toContain('cursor')

    expect(result.hits[0].memory_id).toBe('mem_123')
  })

  it('defaults top_k to 8 when not supplied', async () => {
    const { apiFetch, calls } = makeFakeFetch({ body: recallEmpty })
    await recall(apiFetch, { query: 'x' })
    expect((calls[0].body as { top_k: number }).top_k).toBe(8)
  })

  it('throws a parsed gateway error on a non-2xx envelope', async () => {
    const { apiFetch } = makeFakeFetch({ status: 409, body: conflict409 })
    await expect(recall(apiFetch, { query: 'x' })).rejects.toMatchObject({
      error: { code: 'memory_conflict' },
    })
  })
})

describe('getItem', () => {
  it('GETs /api/memory/items/{id} and returns a memoryItemSchema-valid object', async () => {
    const { apiFetch, calls } = makeFakeFetch({ body: itemFixture })
    const item = await getItem(apiFetch, 'mem_1')
    expect(calls[0].path).toBe('/api/memory/items/mem_1')
    expect(calls[0].method).toBe('GET')
    expect(item.memory_id).toBe('mem_123')
    expect(item.version).toBe(7)
  })
})

describe('write', () => {
  it('POSTs /api/memory/write with {idempotency_key, scope:{}, record} and a fresh UUID; no expected_version', async () => {
    const { apiFetch, calls } = makeFakeFetch({ body: writeResponse })
    await write(apiFetch, { kind: 'episodic', content: 'hi' })
    const c = calls[0]
    expect(c.path).toBe('/api/memory/write')
    expect(c.method).toBe('POST')
    expect(c.headers.get('Content-Type')).toBe('application/json')
    const body = c.body as Record<string, unknown>
    expect(body.scope).toEqual({})
    expect(body.record).toMatchObject({ kind: 'episodic', content: 'hi' })
    expect(typeof body.idempotency_key).toBe('string')
    expect((body.idempotency_key as string).length).toBeGreaterThan(0)
    expect(body).not.toHaveProperty('expected_version')
  })
})

describe('patch', () => {
  it('PATCHes /api/memory/items/{id} with expected_version, patch, scope:{} and a fresh idempotency_key', async () => {
    const { apiFetch, calls } = makeFakeFetch({ body: patchResponse })
    await patch(apiFetch, 'mem_1', { content: 'y' }, 7)
    const c = calls[0]
    expect(c.path).toBe('/api/memory/items/mem_1')
    expect(c.method).toBe('PATCH')
    expect(c.headers.get('Content-Type')).toBe('application/json')
    const body = c.body as Record<string, unknown>
    expect(body.expected_version).toBe(7)
    expect(body.patch).toEqual({ content: 'y' })
    expect(body.scope).toEqual({})
    expect(typeof body.idempotency_key).toBe('string')
    expect((body.idempotency_key as string).length).toBeGreaterThan(0)
  })
})

describe('pin / unpin / disable / enable', () => {
  it('pin POSTs /api/memory/items/{id}/pin with {scope:{}, expected_version} and returns {memory_id,version,pinned}', async () => {
    const { apiFetch, calls } = makeFakeFetch({ body: pinResponse })
    const r = await pin(apiFetch, 'mem_1', 7)
    const c = calls[0]
    expect(c.path).toBe('/api/memory/items/mem_1/pin')
    expect(c.method).toBe('POST')
    expect(c.body).toEqual({ scope: {}, expected_version: 7 })
    expect(r).toMatchObject({ memory_id: 'mem_123', version: 8, pinned: true })
  })

  it('unpin/disable/enable hit their respective action paths with expected_version', async () => {
    const u = makeFakeFetch({ body: { memory_id: 'm', version: 2, pinned: false } })
    await unpin(u.apiFetch, 'mem_1', 1)
    expect(u.calls[0].path).toBe('/api/memory/items/mem_1/unpin')
    expect((u.calls[0].body as Record<string, unknown>).expected_version).toBe(1)

    const d = makeFakeFetch({ body: { memory_id: 'm', version: 2, disabled: true } })
    await disable(d.apiFetch, 'mem_1', 1)
    expect(d.calls[0].path).toBe('/api/memory/items/mem_1/disable')

    const e = makeFakeFetch({ body: { memory_id: 'm', version: 2, disabled: false } })
    await enable(e.apiFetch, 'mem_1', 1)
    expect(e.calls[0].path).toBe('/api/memory/items/mem_1/enable')
  })
})

describe('del (body-bearing DELETE)', () => {
  it('sends DELETE to /api/memory/items/{id} WITH Content-Type json and a {scope:{}, expected_version} body', async () => {
    const { apiFetch, calls } = makeFakeFetch({ body: deleteResponse })
    const r = await del(apiFetch, 'mem_1', 7)
    const c = calls[0]
    expect(c.path).toBe('/api/memory/items/mem_1')
    expect(c.method).toBe('DELETE')
    expect(c.headers.get('Content-Type')).toBe('application/json')
    expect(c.body).toEqual({ scope: {}, expected_version: 7 })
    expect(r).toMatchObject({ memory_id: 'mem_123', deleted: true, version: 10 })
  })
})

describe('parseGatewayError', () => {
  it('returns a 409 memory_conflict surfacing code + details.current_version', async () => {
    const res = new Response(JSON.stringify(conflict409), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    })
    const err = await parseGatewayError(res)
    expect(err.error.code).toBe('memory_conflict')
    expect(err.httpStatus).toBe(409)
    expect(err.conflict?.current_version).toBe(5)
  })

  it('falls back to a synthetic transport_error when the body is not the envelope', async () => {
    const res = new Response('not json at all', { status: 502 })
    const err = await parseGatewayError(res)
    expect(err.error.code).toBe('transport_error')
    expect(err.httpStatus).toBe(502)
  })
})

describe('memoryKeys factory', () => {
  it('recall(params) and item(id) produce stable keys', () => {
    expect(memoryKeys.recall({ query: 'x', top_k: 8 })).toEqual([
      'recall',
      { query: 'x', top_k: 8 },
    ])
    expect(memoryKeys.item('mem_1')).toEqual(['memory-item', 'mem_1'])
  })
})
