import { describe, it, expect } from 'vitest'
import {
  timelineReducer,
  initialTimeline,
  type Timeline,
  type TimelineAction,
} from './reducer'
import {
  goldenSuccess,
  goldenFailure,
  goldenNodeSkipped,
  lateJoinHistory,
  lateJoinLiveTail,
  type SseFrame,
} from '@/test/mocks/fetch-event-source'
import type { SseKind, SsePayload } from '@/features/flow/api/schemas'

/**
 * Keystone unit tests for the PURE timeline reducer (03-03 feature 1).
 *
 * The reducer folds the 6-kind frame log into a render model:
 *   ordered append-only events + per-node status + terminal (+ outputs/error),
 * de-duped on `(kind, node, ordinal)` so the same logical event never doubles —
 * whether it arrived live or via the `/events` history hydrate. ONE reducer
 * serves BOTH live and replay (success criterion 5): identical frames as
 * source:'history' must produce an identical render model to source:'live'.
 */

/** Replay an SSE frame array (from the golden fixtures) through the reducer as
 * live events; returns the final Timeline. */
function reduceLive(frames: SseFrame[], from: Timeline = initialTimeline): Timeline {
  return frames.reduce<Timeline>(
    (st, f) =>
      timelineReducer(st, {
        type: 'event',
        source: 'live',
        kind: f.event as SseKind,
        payload: JSON.parse(f.data) as SsePayload,
      }),
    from,
  )
}

/** Replay history RunEvent rows (carry seq) through the reducer as history. */
function reduceHistory(
  rows: Array<{ seq: number; kind: string; payload: unknown }>,
  from: Timeline = initialTimeline,
): Timeline {
  return rows.reduce<Timeline>(
    (st, r) =>
      timelineReducer(st, {
        type: 'event',
        source: 'history',
        kind: r.kind as SseKind,
        payload: r.payload as SsePayload,
        seq: r.seq,
      }),
    from,
  )
}

describe('timelineReducer — initial state', () => {
  it('starts empty: no events, no node status, terminal none', () => {
    expect(initialTimeline.events).toEqual([])
    expect(initialTimeline.nodeStatus).toEqual({})
    expect(initialTimeline.terminal).toBe('none')
    expect(initialTimeline.outputs).toBeUndefined()
    expect(initialTimeline.error).toBeUndefined()
  })
})

describe('timelineReducer — golden success sequence', () => {
  const tl = reduceLive(goldenSuccess)

  it('appends every frame in arrival order', () => {
    expect(tl.events.map((e) => e.kind)).toEqual([
      'flow_started',
      'node_started',
      'node_finished',
      'flow_done',
    ])
  })

  it('marks the node done after node_finished', () => {
    expect(tl.nodeStatus.upper).toBe('done')
  })

  it('terminal=done and captures outputs from flow_done', () => {
    expect(tl.terminal).toBe('done')
    expect(tl.outputs).toEqual({ out: 'OLLEH' })
    expect(tl.error).toBeUndefined()
  })

  it('transitions a node through running before done', () => {
    // After only flow_started + node_started, the node is running.
    const partial = reduceLive(goldenSuccess.slice(0, 2))
    expect(partial.nodeStatus.upper).toBe('running')
    expect(partial.terminal).toBe('none')
  })
})

describe('timelineReducer — failure sequence (flow_err)', () => {
  const tl = reduceLive(goldenFailure)

  it('terminal=error and captures the error payload', () => {
    expect(tl.terminal).toBe('error')
    expect(tl.error).toBe('missing required input: in')
  })

  it('retains the partial events emitted before the error', () => {
    expect(tl.events.map((e) => e.kind)).toEqual([
      'flow_started',
      'node_started',
      'flow_err',
    ])
  })

  it('marks the attributable node errored when flow_err carries a node', () => {
    const withNode = reduceLive([
      { event: 'flow_started', data: JSON.stringify({ flow: 'f' }) },
      { event: 'node_started', data: JSON.stringify({ node: 'boom', input: {} }) },
      { event: 'flow_err', data: JSON.stringify({ node: 'boom', error: 'kaboom' }) },
    ])
    expect(withNode.nodeStatus.boom).toBe('errored')
    expect(withNode.terminal).toBe('error')
    expect(withNode.error).toBe('kaboom')
  })
})

describe('timelineReducer — node_skipped variant', () => {
  const tl = reduceLive(goldenNodeSkipped)

  it("sets the skipped node's status to skipped", () => {
    expect(tl.nodeStatus.right_branch).toBe('skipped')
  })

  it('still folds the rest of the run to done', () => {
    expect(tl.nodeStatus.route).toBe('done')
    expect(tl.nodeStatus.left_branch).toBe('done')
    expect(tl.terminal).toBe('done')
    expect(tl.outputs).toEqual({ out: 'L' })
  })
})

describe('timelineReducer — (kind,node,ordinal) de-dup (THE keystone)', () => {
  it('merges history[1,2,3] + live tail[3,4,5] → [1,2,3,4,5], overlap appears once', () => {
    // Hydrate the history prefix (seq 1..3), then feed a live tail that re-sends
    // the 3rd event (node_finished upper) then continues with flow_done.
    const afterHistory = reduceHistory(lateJoinHistory)
    expect(afterHistory.events).toHaveLength(3)

    const merged = reduceLive(lateJoinLiveTail, afterHistory)

    // The overlapping node_finished(upper) must NOT double — 4 distinct events:
    // flow_started, node_started, node_finished, flow_done.
    expect(merged.events.map((e) => e.kind)).toEqual([
      'flow_started',
      'node_started',
      'node_finished',
      'flow_done',
    ])
    // exactly ONE node_finished for upper
    const finishes = merged.events.filter(
      (e) => e.kind === 'node_finished' && e.node === 'upper',
    )
    expect(finishes).toHaveLength(1)
    expect(merged.terminal).toBe('done')
    expect(merged.outputs).toEqual({ out: 'OLLEH' })
  })

  it('is idempotent when /events history re-hydrates a prefix already played live (D-09)', () => {
    // The real D-09 / IC-6 retry scenario: a live stream already rendered the
    // prefix [flow_started, node_started, node_finished]; the transport drops;
    // retry() hydrates GET /events (the SAME prefix as history) — nothing must
    // double, and the run continues to flow_done.
    const live = reduceLive(goldenSuccess.slice(0, 3)) // 3 live frames rendered
    expect(live.events).toHaveLength(3)

    const historyPrefix = lateJoinHistory // seq 1..3 = the same prefix
    const afterHydrate = reduceHistory(historyPrefix, live)

    // The history re-send of the already-seen prefix de-dups: still 3 events.
    expect(afterHydrate.events).toHaveLength(3)
    expect(afterHydrate.events.map((e) => e.kind)).toEqual([
      'flow_started',
      'node_started',
      'node_finished',
    ])
  })
})

describe('timelineReducer — replay parity (success criterion 5)', () => {
  it('feeding the SAME golden frames as history yields an identical render model to live', () => {
    const live = reduceLive(goldenSuccess)
    const asHistoryRows = goldenSuccess.map((f, i) => ({
      seq: i + 1,
      kind: f.event,
      payload: JSON.parse(f.data),
    }))
    const history = reduceHistory(asHistoryRows)

    // Compare the render-relevant model (ignore the per-event source tag).
    expect(history.events.map((e) => ({ kind: e.kind, node: e.node }))).toEqual(
      live.events.map((e) => ({ kind: e.kind, node: e.node })),
    )
    expect(history.nodeStatus).toEqual(live.nodeStatus)
    expect(history.terminal).toBe(live.terminal)
    expect(history.outputs).toEqual(live.outputs)
  })
})

describe('timelineReducer — reset', () => {
  it('clears back to the initial timeline', () => {
    const tl = reduceLive(goldenSuccess)
    expect(tl.events.length).toBeGreaterThan(0)
    const reset = timelineReducer(tl, { type: 'reset' } satisfies TimelineAction)
    expect(reset).toEqual(initialTimeline)
  })
})
