import { describe, it, expect } from 'vitest'
import {
  writeRecordSchema,
  patchFieldsSchema,
  recallResponseSchema,
  memoryItemSchema,
  gatewayErrorSchema,
  memoryConflictDetailsSchema,
} from './schemas'
import {
  recallNonEmpty,
  recallEmpty,
  itemFixture,
  conflict409,
} from '@/test/mocks/memory-gateway'

describe('writeRecordSchema (D-07 gateway write rules)', () => {
  it('rejects empty content (content min length 1)', () => {
    const r = writeRecordSchema.safeParse({ kind: 'semantic', content: '' })
    expect(r.success).toBe(false)
  })

  it('rejects an unknown kind', () => {
    const r = writeRecordSchema.safeParse({ kind: 'bogus', content: 'x' })
    expect(r.success).toBe(false)
  })

  it('accepts a valid episodic record', () => {
    const r = writeRecordSchema.safeParse({ kind: 'episodic', content: 'hi' })
    expect(r.success).toBe(true)
  })
})

describe('patchFieldsSchema (D-07 patch rules)', () => {
  it('rejects an empty object (no keys present)', () => {
    const r = patchFieldsSchema.safeParse({})
    expect(r.success).toBe(false)
    if (!r.success) {
      // The refine message should mention "at least one" so the editor surfaces it.
      expect(JSON.stringify(r.error.issues)).toMatch(/at least one/i)
    }
  })

  it('accepts a content-only patch', () => {
    expect(patchFieldsSchema.safeParse({ content: 'x' }).success).toBe(true)
  })

  it('accepts a tags-only patch', () => {
    expect(patchFieldsSchema.safeParse({ tags: ['a'] }).success).toBe(true)
  })

  it('rejects non-patchable fields (kind/source/pinned/disabled are not patchable)', () => {
    expect(patchFieldsSchema.safeParse({ kind: 'semantic' }).success).toBe(false)
    expect(patchFieldsSchema.safeParse({ pinned: true }).success).toBe(false)
    expect(patchFieldsSchema.safeParse({ source: 'user_saved' }).success).toBe(
      false,
    )
  })
})

describe('recallResponseSchema (golden recall_unified_response shape)', () => {
  it('accepts the golden non-empty recall response', () => {
    const r = recallResponseSchema.safeParse(recallNonEmpty)
    expect(r.success).toBe(true)
    if (r.success) {
      const hit = r.data.hits[0]
      expect(hit.memory_id).toBe('mem_123')
      expect(hit.kind).toBe('semantic')
      expect(hit.score).toBe(0.95)
      expect(hit.version).toBe(7)
      expect(hit.pinned).toBe(true)
      expect(hit.disabled).toBe(false)
    }
  })

  it('accepts an empty-hits response ({ hits: [] })', () => {
    const r = recallResponseSchema.safeParse(recallEmpty)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.hits).toHaveLength(0)
  })
})

describe('memoryItemSchema (golden get_memory_item_response shape)', () => {
  it('accepts the golden item record', () => {
    const r = memoryItemSchema.safeParse(itemFixture)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.memory_id).toBe('mem_123')
      expect(r.data.version).toBe(7)
      expect(r.data.importance).toBe(0.95)
      expect(r.data.pinned).toBe(true)
      expect(r.data.disabled).toBe(false)
    }
  })

  it('accepts an item with importance and tags omitted', () => {
    const r = memoryItemSchema.safeParse({
      memory_id: 'mem_9',
      kind: 'working',
      version: 1,
      content: 'x',
      pinned: false,
      disabled: false,
    })
    expect(r.success).toBe(true)
  })
})

describe('gatewayErrorSchema + memoryConflictDetailsSchema (golden error_response shape)', () => {
  it('accepts the golden 409 memory_conflict envelope and exposes current_version', () => {
    const r = gatewayErrorSchema.safeParse(conflict409)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.error.code).toBe('memory_conflict')
      const details = memoryConflictDetailsSchema.parse(r.data.error.details)
      expect(details.current_version).toBe(5)
      expect(details.expected_version).toBe(4)
      expect(details.memory_id).toBe('mem_123')
    }
  })

  it('accepts a generic error envelope with an empty details map', () => {
    const r = gatewayErrorSchema.safeParse({
      error: {
        code: 'not_found',
        message: 'unknown memory_id',
        request_id: 'req_1',
        retryable: false,
        details: {},
      },
    })
    expect(r.success).toBe(true)
  })
})
