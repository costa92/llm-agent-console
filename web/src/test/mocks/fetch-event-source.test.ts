import { describe, it, expect, vi } from 'vitest'
import {
  makeFakeSseStream,
  frames,
  goldenSuccess,
  goldenFailure,
  goldenNodeSkipped,
  lateJoinHistory,
  lateJoinLiveTail,
} from './fetch-event-source'

/**
 * The fake's `openSseStream` IS a drop-in for the real wrapper (it has the same
 * call signature), so these tests call it directly — no module mock needed.
 */

describe('golden frame sequences (verified flowd shapes)', () => {
  it('goldenSuccess is a terminal-flow_done linear run', () => {
    expect(goldenSuccess.map((f) => f.event)).toEqual([
      'flow_started',
      'node_started',
      'node_finished',
      'flow_done',
    ])
  })

  it('goldenFailure ends in flow_err carrying an error payload', () => {
    const last = goldenFailure.at(-1)!
    expect(last.event).toBe('flow_err')
    expect(JSON.parse(last.data)).toMatchObject({ error: expect.any(String) })
  })

  it('goldenNodeSkipped includes a node_skipped frame', () => {
    expect(goldenNodeSkipped.map((f) => f.event)).toContain('node_skipped')
  })

  it('late-join history is the [seq 1..3] prefix the live tail [3..] overlaps', () => {
    expect(lateJoinHistory.map((e) => e.seq)).toEqual([1, 2, 3])
    // The live tail's first frame is the same logical event as history seq 3
    // (node_finished/upper) — the reducer (03-03) de-dups them to one.
    expect(JSON.parse(lateJoinLiveTail[0].data)).toMatchObject({ node: 'upper' })
    expect(lateJoinLiveTail.at(-1)!.event).toBe('flow_done')
  })

  it('frames() builds {event,data} pairs from {kind,payload}', () => {
    const out = frames([{ kind: 'flow_started', payload: { flow: 'x' } }])
    expect(out).toEqual([{ event: 'flow_started', data: '{"flow":"x"}' }])
  })
})

describe('controllable emitter — onOpen/X-Run-ID, scripted frames, clean close', () => {
  it('emitOpen supplies an open Response whose X-Run-ID header is readable', async () => {
    const fake = makeFakeSseStream()
    const onMessage = vi.fn()
    let runId: string | null = null
    const p = fake.openSseStream({
      url: '/x',
      onMessage,
      onOpen: (res: Response) => {
        runId = res.headers.get('X-Run-ID')
      },
    })
    await fake.emitOpen({ 'Content-Type': 'text/event-stream', 'X-Run-ID': 'run_7' })
    expect(runId).toBe('run_7')

    fake.emit(goldenSuccess)
    expect(onMessage).toHaveBeenCalledTimes(4)

    await fake.close()
    await expect(p).resolves.toBeUndefined()
  })

  it('captures the caller options (url/method/body) for assertion', () => {
    const fake = makeFakeSseStream()
    void fake.openSseStream({
      url: '/api/flow/flows/f/run/stream',
      method: 'POST',
      body: '{"inputs":{}}',
      onMessage: vi.fn(),
    })
    expect(fake.captured()).toMatchObject({
      url: '/api/flow/flows/f/run/stream',
      method: 'POST',
      body: '{"inputs":{}}',
    })
  })
})

describe('controllable emitter — onError + transport drop rejects', () => {
  it('fail() invokes onError and rejects the stream promise', async () => {
    const fake = makeFakeSseStream()
    const onError = vi.fn()
    const p = fake.openSseStream({ url: '/x', onMessage: vi.fn(), onError })
    p.catch(() => {}) // observe the rejection below, keep it from being unhandled
    await fake.emitOpen()
    await fake.fail(new Error('drop'))
    expect(onError).toHaveBeenCalledTimes(1)
    await expect(p).rejects.toThrow('drop')
  })
})
