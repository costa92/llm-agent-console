import { describe, it, expect } from 'vitest'
import {
  flowMetaSchema,
  flowRecordSchema,
  runMetaSchema,
  runRecordSchema,
  runEventSchema,
  sseKindEnum,
  ssePayloadSchema,
  flowdErrorSchema,
} from './schemas'
import {
  flowMetaFixture,
  flowRecordFixture,
  runMetaFixture,
  runRecordFixture,
  runEventsFixture,
  flowdError400,
} from '@/test/mocks/flowd'

/**
 * Schemas mirror the VERIFIED flowd contract (03-RESEARCH.md "THE FLOWD
 * CONTRACT"). They narrow untrusted upstream JSON before it reaches UI state
 * (T-03-02). flowd is the authoritative validator (compileProbe) — these only
 * mirror the wire shape.
 */

describe('flowMetaSchema (FlowMeta wire shape)', () => {
  it('accepts the golden flow-meta fixture', () => {
    const r = flowMetaSchema.safeParse(flowMetaFixture)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.id).toBe('echo_chain')
      expect(r.data.name).toBe('Echo Chain')
    }
  })

  it('accepts a meta with name omitted (name is optional)', () => {
    const r = flowMetaSchema.safeParse({
      id: 'f1',
      created_at: '2026-06-03T00:00:00Z',
      updated_at: '2026-06-03T00:00:00Z',
    })
    expect(r.success).toBe(true)
  })
})

describe('flowRecordSchema (FlowRecord = FlowMeta + json base64 STRING)', () => {
  it('accepts the golden record and keeps json as an UN-decoded base64 string', () => {
    const r = flowRecordSchema.safeParse(flowRecordFixture)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.id).toBe('echo_chain')
      // json is validated as a string, NOT decoded by the schema.
      expect(typeof r.data.json).toBe('string')
      expect(r.data.json).toBe(flowRecordFixture.json)
    }
  })

  it('rejects a record whose json is not a string', () => {
    const r = flowRecordSchema.safeParse({
      ...flowRecordFixture,
      json: { id: 'inline' },
    })
    expect(r.success).toBe(false)
  })
})

describe('runMetaSchema (status enum + optional finished_at)', () => {
  it('accepts the golden run-meta fixture', () => {
    const r = runMetaSchema.safeParse(runMetaFixture)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.status).toBe('done')
  })

  it('accepts a running run with finished_at omitted', () => {
    const r = runMetaSchema.safeParse({
      id: 'run_x',
      flow_id: 'echo_chain',
      status: 'running',
      started_at: '2026-06-03T00:00:00Z',
    })
    expect(r.success).toBe(true)
  })

  it('rejects an unknown status', () => {
    const r = runMetaSchema.safeParse({
      id: 'run_x',
      flow_id: 'echo_chain',
      status: 'bogus',
      started_at: '2026-06-03T00:00:00Z',
    })
    expect(r.success).toBe(false)
  })
})

describe('runRecordSchema (RunMeta + optional inputs/outputs/error)', () => {
  it('accepts the golden run-record fixture', () => {
    const r = runRecordSchema.safeParse(runRecordFixture)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.status).toBe('done')
      expect(r.data.outputs).toMatchObject({ out: 'OLLEH' })
    }
  })

  it('accepts a failed run carrying only an error', () => {
    const r = runRecordSchema.safeParse({
      id: 'run_f',
      flow_id: 'echo_chain',
      status: 'failed',
      started_at: '2026-06-03T00:00:00Z',
      finished_at: '2026-06-03T00:00:01Z',
      error: 'missing required input',
    })
    expect(r.success).toBe(true)
  })
})

describe('runEventSchema (seq lives ONLY here, not in SSE frames)', () => {
  it('accepts each golden run event with seq + payload', () => {
    for (const ev of runEventsFixture.events) {
      const r = runEventSchema.safeParse(ev)
      expect(r.success).toBe(true)
    }
  })

  it('carries a numeric seq and optional node_id', () => {
    const r = runEventSchema.safeParse({
      seq: 3,
      kind: 'node_finished',
      node_id: 'upper',
      payload: { node: 'upper', output: { out: 'OLLEH' } },
      ts: '2026-06-03T00:00:00Z',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.seq).toBe(3)
      expect(r.data.node_id).toBe('upper')
    }
  })
})

describe('sseKindEnum (the 6 frame kinds)', () => {
  it('accepts all six kinds and rejects an unknown one', () => {
    for (const k of [
      'flow_started',
      'node_started',
      'node_finished',
      'node_skipped',
      'flow_done',
      'flow_err',
    ]) {
      expect(sseKindEnum.safeParse(k).success).toBe(true)
    }
    expect(sseKindEnum.safeParse('node_paused').success).toBe(false)
  })
})

describe('ssePayloadSchema (loose, all-optional populated-keys subset)', () => {
  it('accepts a flow_started payload (flow only)', () => {
    expect(ssePayloadSchema.safeParse({ flow: 'echo_chain' }).success).toBe(true)
  })

  it('accepts a node_finished payload (node + output)', () => {
    const r = ssePayloadSchema.safeParse({
      node: 'upper',
      output: { out: 'OLLEH' },
    })
    expect(r.success).toBe(true)
  })

  it('accepts a flow_done payload (outputs) and a flow_err payload (error)', () => {
    expect(ssePayloadSchema.safeParse({ outputs: { out: 'OLLEH' } }).success).toBe(
      true,
    )
    expect(ssePayloadSchema.safeParse({ error: 'boom' }).success).toBe(true)
  })

  it('is loose — tolerates an empty payload and unknown keys', () => {
    expect(ssePayloadSchema.safeParse({}).success).toBe(true)
    expect(ssePayloadSchema.safeParse({ surprise: 1 }).success).toBe(true)
  })
})

describe('flowdErrorSchema (FLAT {error:string})', () => {
  it('accepts the golden flat error envelope', () => {
    const r = flowdErrorSchema.safeParse(flowdError400)
    expect(r.success).toBe(true)
    if (r.success) expect(typeof r.data.error).toBe('string')
  })

  it('rejects a body missing error (so the parser can fall back gracefully)', () => {
    expect(flowdErrorSchema.safeParse({}).success).toBe(false)
    expect(flowdErrorSchema.safeParse({ error: { code: 'x' } }).success).toBe(
      false,
    )
  })
})
