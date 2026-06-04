import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  FLOW_BASE,
  listFlows,
  getFlow,
  createFlow,
  putFlow,
  deleteFlow,
  runSync,
  listRuns,
  getRun,
  listRunEvents,
  parseFlowdError,
  FlowdError,
} from './client'
import { runStream, replayStream } from './stream'
import { flowKeys } from './queries'
import {
  flowsListFixture,
  flowRecordFixture,
  flowJsonBase64,
  flowDefinition,
  runsListFixture,
  runMetaFixture,
  runRecordFixture,
  runEventsFixture,
  runEventsEmpty,
  runSyncResponse,
  flowdError400,
  flowdError409,
  flowdError404,
  flowdError500,
  installFlowdFetchMock,
} from '@/test/mocks/flowd'
import {
  makeFakeSseStream,
  goldenSuccess,
} from '@/test/mocks/fetch-event-source'

// The stream wrappers go through the openSseStream wrapper; mock that module so
// no real network/fetchEventSource runs. A factory + ref lets each test install
// a fresh controllable emitter.
const sseRef: { fake: ReturnType<typeof makeFakeSseStream> } = {
  fake: makeFakeSseStream(),
}
vi.mock('@/lib/sse', () => ({
  openSseStream: (o: unknown) =>
    (sseRef.fake.openSseStream as (x: unknown) => Promise<void>)(o),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  sseRef.fake = makeFakeSseStream()
})

describe('FLOW_BASE', () => {
  it('is the Phase-1 BFF prefix /api/flow', () => {
    expect(FLOW_BASE).toBe('/api/flow')
  })
})

describe('listFlows', () => {
  it('GETs /api/flow/flows and returns the parsed flows array', async () => {
    const { fetchMock } = installFlowdFetchMock([
      { method: 'GET', path: '/api/flow/flows', body: flowsListFixture },
    ])
    const flows = await listFlows()
    expect(flows).toHaveLength(2)
    expect(flows[0].id).toBe('echo_chain')
    const call = fetchMock.mock.calls[0]
    expect((call[1]?.headers as Headers | undefined) ?? undefined).toBeUndefined()
  })
})

describe('getFlow (base64 decode-on-load — A1)', () => {
  it('GETs /api/flow/flows/{id}, base64-decodes json → flow object + keeps the raw record', async () => {
    installFlowdFetchMock([
      {
        method: 'GET',
        path: '/api/flow/flows/echo_chain',
        body: flowRecordFixture,
      },
    ])
    const rec = await getFlow('echo_chain')
    expect(rec.id).toBe('echo_chain')
    // raw base64 string is preserved...
    expect(rec.json).toBe(flowJsonBase64)
    // ...and the decoded flow object is exposed for the editor.
    expect(rec.flow).toEqual(flowDefinition)
  })
})

describe('createFlow', () => {
  it('POSTs /api/flow/flows with {id?, name?, flow} (raw flow, not base64)', async () => {
    const { fetchMock } = installFlowdFetchMock([
      { method: 'POST', path: '/api/flow/flows', status: 201, body: flowRecordFixture },
    ])
    await createFlow({ id: 'echo_chain', name: 'Echo Chain', flow: flowDefinition })
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string)
    expect(body).toMatchObject({ id: 'echo_chain', name: 'Echo Chain', flow: flowDefinition })
  })

  it('throws a FlowdError carrying the flat {error} on a 409 duplicate', async () => {
    installFlowdFetchMock([
      { method: 'POST', path: '/api/flow/flows', status: 409, body: flowdError409 },
    ])
    await expect(
      createFlow({ id: 'echo_chain', flow: flowDefinition }),
    ).rejects.toMatchObject({ status: 409, message: flowdError409.error })
  })
})

describe('putFlow (raw flow, OMIT id — Pitfall 4)', () => {
  it('PUTs /api/flow/flows/{id} with {name?, flow} and NO id in the body', async () => {
    const { fetchMock } = installFlowdFetchMock([
      { method: 'PUT', path: '/api/flow/flows/echo_chain', body: flowRecordFixture },
    ])
    await putFlow('echo_chain', flowDefinition, 'Echo Chain')
    const init = fetchMock.mock.calls[0][1]!
    expect((init.method ?? 'GET').toUpperCase()).toBe('PUT')
    const body = JSON.parse(init.body as string)
    expect(body).not.toHaveProperty('id')
    expect(body.flow).toEqual(flowDefinition)
    expect(body.name).toBe('Echo Chain')
  })

  it('surfaces a 400 compile error as a FlowdError with the flat message', async () => {
    installFlowdFetchMock([
      { method: 'PUT', path: '/api/flow/flows/echo_chain', status: 400, body: flowdError400 },
    ])
    await expect(putFlow('echo_chain', flowDefinition)).rejects.toMatchObject({
      status: 400,
      message: flowdError400.error,
    })
  })
})

describe('deleteFlow (204 = success, NO body parse — Pitfall 5)', () => {
  it('DELETEs /api/flow/flows/{id} and resolves on 204 without parsing a body', async () => {
    // Route has no `body` → harness returns a genuinely empty 204 response.
    installFlowdFetchMock([
      { method: 'DELETE', path: '/api/flow/flows/echo_chain' },
    ])
    await expect(deleteFlow('echo_chain')).resolves.toBeUndefined()
  })

  it('throws a FlowdError on a 404 delete', async () => {
    installFlowdFetchMock([
      { method: 'DELETE', path: '/api/flow/flows/missing', status: 404, body: flowdError404 },
    ])
    await expect(deleteFlow('missing')).rejects.toMatchObject({ status: 404 })
  })
})

describe('runSync (FLOW-03)', () => {
  it('POSTs /api/flow/flows/{id}/run with {inputs} → {outputs, run_id} on success', async () => {
    const { fetchMock } = installFlowdFetchMock([
      { method: 'POST', path: '/api/flow/flows/echo_chain/run', body: runSyncResponse },
    ])
    const r = await runSync('echo_chain', { in: 'hello' })
    expect(r.outputs).toEqual({ out: 'OLLEH' })
    expect(r.run_id).toBe('run_sync_1')
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string)
    expect(body).toEqual({ inputs: { in: 'hello' } })
  })

  it('throws a FlowdError carrying the flat {error} on a failed run', async () => {
    installFlowdFetchMock([
      { method: 'POST', path: '/api/flow/flows/echo_chain/run', status: 500, body: flowdError500 },
    ])
    await expect(runSync('echo_chain', {})).rejects.toMatchObject({
      status: 500,
      message: flowdError500.error,
    })
  })
})

describe('listRuns / getRun (FLOW-05)', () => {
  it('listRuns GETs /api/flow/flows/{id}/runs → runs array', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: '/api/flow/flows/echo_chain/runs', body: runsListFixture },
    ])
    const runs = await listRuns('echo_chain')
    expect(runs).toHaveLength(2)
    expect(runs[0].id).toBe(runMetaFixture.id)
  })

  it('getRun GETs /api/flow/runs/{id} → RunRecord', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: '/api/flow/runs/run_abc', body: runRecordFixture },
    ])
    const run = await getRun('run_abc')
    expect(run.status).toBe('done')
    expect(run.outputs).toMatchObject({ out: 'OLLEH' })
  })

  it('getRun throws on a 404 unknown run', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: '/api/flow/runs/nope', status: 404, body: flowdError404 },
    ])
    await expect(getRun('nope')).rejects.toMatchObject({ status: 404 })
  })
})

describe('listRunEvents (FLOW-06 — empty events is a valid empty result)', () => {
  it('GETs /api/flow/runs/{id}/events → events array', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: '/api/flow/runs/run_abc/events', body: runEventsFixture },
    ])
    const events = await listRunEvents('run_abc')
    expect(events).toHaveLength(4)
    expect(events[0].seq).toBe(1)
    expect(events[3].kind).toBe('flow_done')
  })

  it('treats a 200 + {events:[]} as a valid EMPTY result (not an error)', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: '/api/flow/runs/fresh/events', body: runEventsEmpty },
    ])
    await expect(listRunEvents('fresh')).resolves.toEqual([])
  })

  it('maps a 404 to "no such run" via FlowdError', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: '/api/flow/runs/nope/events', status: 404, body: flowdError404 },
    ])
    await expect(listRunEvents('nope')).rejects.toBeInstanceOf(FlowdError)
  })
})

describe('parseFlowdError (FLAT envelope — NOT the gateway shape)', () => {
  it('reads {error:string} and surfaces it as a FlowdError', async () => {
    const res = new Response(JSON.stringify(flowdError400), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
    const err = await parseFlowdError(res)
    expect(err).toBeInstanceOf(FlowdError)
    expect(err.status).toBe(400)
    expect(err.message).toBe(flowdError400.error)
  })

  it('falls back to statusText when the body is absent/malformed', async () => {
    const res = new Response('not json', { status: 502, statusText: 'Bad Gateway' })
    const err = await parseFlowdError(res)
    expect(err.status).toBe(502)
    expect(err.message).toBe('Bad Gateway')
  })
})

describe('runStream / replayStream (D-08 — surface X-Run-ID via onRunId; NO auth headers)', () => {
  it('runStream POSTs /run/stream with NO Authorization / X-Console-* and surfaces X-Run-ID exactly once', async () => {
    const onRunId = vi.fn()
    const onMessage = vi.fn()
    void runStream(
      'echo_chain',
      { in: 'hello' },
      { onMessage, onRunId },
    )
    // The wrapper was called; inspect the captured options.
    const cap = sseRef.fake.captured()!
    expect(cap.url).toBe('/api/flow/flows/echo_chain/run/stream')
    expect(cap.method).toBe('POST')
    expect(JSON.parse(cap.body!)).toEqual({ inputs: { in: 'hello' } })
    // NO auth / scope headers on the flow stream call.
    const hdrs = cap.headers ?? {}
    expect(hdrs).not.toHaveProperty('Authorization')
    expect(Object.keys(hdrs).some((k) => /^x-console-/i.test(k))).toBe(false)

    // Drive onOpen with an X-Run-ID header → onRunId fires once.
    await sseRef.fake.emitOpen({
      'Content-Type': 'text/event-stream',
      'X-Run-ID': 'run_42',
    })
    expect(onRunId).toHaveBeenCalledTimes(1)
    expect(onRunId).toHaveBeenCalledWith('run_42')

    // Scripted frames reach onMessage.
    sseRef.fake.emit(goldenSuccess)
    expect(onMessage).toHaveBeenCalledTimes(goldenSuccess.length)
    expect(onMessage.mock.calls[0][0]).toMatchObject({ event: 'flow_started' })

    // A second open (reconnect) must NOT re-fire onRunId for the same run.
    await sseRef.fake.emitOpen({
      'Content-Type': 'text/event-stream',
      'X-Run-ID': 'run_42',
    })
    expect(onRunId).toHaveBeenCalledTimes(1)
  })

  it('replayStream POSTs /runs/{id}/replay with no auth and surfaces X-Run-ID', async () => {
    const onRunId = vi.fn()
    void replayStream('run_42', { onMessage: vi.fn(), onRunId })
    const cap = sseRef.fake.captured()!
    expect(cap.url).toBe('/api/flow/runs/run_42/replay')
    expect(cap.method).toBe('POST')
    await sseRef.fake.emitOpen({
      'Content-Type': 'text/event-stream',
      'X-Run-ID': 'run_42',
    })
    expect(onRunId).toHaveBeenCalledWith('run_42')
  })
})

describe('flowKeys factory', () => {
  it('produces stable query keys for flows/flow/runs/run/runEvents', () => {
    expect(flowKeys.flows()).toEqual(['flows'])
    expect(flowKeys.flow('echo_chain')).toEqual(['flow', 'echo_chain'])
    expect(flowKeys.runs('echo_chain')).toEqual(['flow-runs', 'echo_chain'])
    expect(flowKeys.run('run_abc')).toEqual(['run', 'run_abc'])
    expect(flowKeys.runEvents('run_abc')).toEqual(['run-events', 'run_abc'])
  })
})
