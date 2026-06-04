import type { SseKind, SsePayload } from '@/features/flow/api/schemas'

/**
 * The PURE timeline reducer — the keystone renderer contract (03-RESEARCH.md
 * "pure timeline reducer"). It folds the 6-kind SSE frame log into a render
 * model and is the SINGLE code path for BOTH live streaming and replay/history
 * hydration (success criterion 5).
 *
 * No I/O, no React, no time — a deterministic `(state, action) → state` fn so
 * the keystone streaming logic is provable WITHOUT a live flowd.
 *
 * THE de-dup constraint (Pitfall 2): SSE frames carry NO `seq`/`id`/`ts` — only
 * the `GET /events` JSON does. So logical identity = `(kind, node, ordinal)`,
 * where `ordinal` is the per-source Nth-occurrence index of `(kind, node)` —
 * counted INDEPENDENTLY for live and history, each starting at 1. The carried
 * `seq` is NOT the ordinal (it counts globally across kinds, so it would mix
 * ordinal spaces and break the collision); `seq` only confirms history is a
 * clean PREFIX of live. Because flowd persists each event BEFORE forwarding it,
 * history never reorders, so the same logical event gets the same key across
 * sources and de-dup is a safe set membership check.
 */

/** Per-node lifecycle status derived from the node_* frames (+ flow_err). */
export type NodeStatus = 'pending' | 'running' | 'done' | 'skipped' | 'errored'

/** Terminal disposition of the whole run. */
export type Terminal = 'none' | 'done' | 'error'

/** One folded timeline event (render row). `ordinal` is the de-dup ordinal. */
export type TimelineEvent = {
  kind: SseKind
  node?: string
  payload: SsePayload
  ordinal: number
  source: 'live' | 'history'
}

/** The render model the reducer produces. `seen` holds the de-dup keys. */
export type Timeline = {
  events: TimelineEvent[]
  seen: Set<string>
  /**
   * Per-source `(kind,node)` arrival counters. Each source (live / history)
   * counts its OWN occurrences from 1, so the de-dup key for the same logical
   * event collides across sources (a history re-send and the live frame both
   * map to occurrence N). Internal bookkeeping — not for rendering.
   */
  ordinals: { live: Record<string, number>; history: Record<string, number> }
  nodeStatus: Record<string, NodeStatus>
  terminal: Terminal
  outputs?: Record<string, string>
  error?: string
}

/** The reducer action union. */
export type TimelineAction =
  | { type: 'reset' }
  | {
      type: 'event'
      source: 'live' | 'history'
      kind: SseKind
      payload: SsePayload
      /** Present for history events (the RunEvent `seq`); absent for live. */
      seq?: number
    }

/** The empty timeline (frozen so callers can compare/return it directly). */
export const initialTimeline: Timeline = Object.freeze({
  events: [],
  seen: new Set<string>(),
  ordinals: { live: {}, history: {} },
  nodeStatus: {},
  terminal: 'none',
}) as Timeline

/** The node a frame is attributable to (payload.node), if any. */
function frameNode(payload: SsePayload): string | undefined {
  return typeof payload.node === 'string' ? payload.node : undefined
}

/**
 * Derive the de-dup ordinal: the Nth occurrence of `(kind, node)` WITHIN the
 * incoming event's OWN source stream (live counts live, history counts history),
 * each from 1.
 *
 * Why per-source (not merged-global): a live frame and the history re-send of
 * the SAME logical event are each occurrence N of their own stream, so they
 * produce the IDENTICAL key `${kind}:${node}:${N}` and de-dup against each other
 * — that is what makes "history[1,2,3] + live tail[3,4,5] → [1,2,3,4,5] once"
 * and the D-09 /events-hydrate-after-live-prefix both idempotent. The server
 * `seq` only proves ordering (history is a clean PREFIX of live, Pitfall 2); it
 * is NOT the ordinal because it counts globally across kinds.
 */
function nextOrdinal(
  ordinals: Record<string, number>,
  groupKey: string,
): number {
  return (ordinals[groupKey] ?? 0) + 1
}

/** Apply a frame to the per-node status map (immutably). */
function applyNodeStatus(
  nodeStatus: Record<string, NodeStatus>,
  kind: SseKind,
  node: string | undefined,
): Record<string, NodeStatus> {
  if (!node) return nodeStatus
  let next: NodeStatus | undefined
  switch (kind) {
    case 'node_started':
      next = 'running'
      break
    case 'node_finished':
      next = 'done'
      break
    case 'node_skipped':
      next = 'skipped'
      break
    case 'flow_err':
      // flow_err may carry the node that failed → mark it errored.
      next = 'errored'
      break
    default:
      next = undefined
  }
  if (!next) return nodeStatus
  return { ...nodeStatus, [node]: next }
}

export function timelineReducer(
  state: Timeline,
  action: TimelineAction,
): Timeline {
  switch (action.type) {
    case 'reset':
      return initialTimeline
    case 'event': {
      const node = frameNode(action.payload)
      const groupKey = `${action.kind}:${node ?? ''}`
      // Per-source occurrence index: this is the Nth (kind,node) event in its
      // OWN source stream. Bump the source's counter regardless of whether the
      // event ends up de-duped, so streams stay independently aligned.
      const ordinal = nextOrdinal(state.ordinals[action.source], groupKey)
      const ordinals = {
        ...state.ordinals,
        [action.source]: {
          ...state.ordinals[action.source],
          [groupKey]: ordinal,
        },
      }
      const key = `${groupKey}:${ordinal}`

      // De-dup: the same logical event arriving from the other source (late-join
      // overlap / D-09 /events hydrate after a live prefix) is a no-op — only the
      // source counter advances so nothing doubles in the render log.
      if (state.seen.has(key)) {
        return { ...state, ordinals }
      }

      const ev: TimelineEvent = {
        kind: action.kind,
        node,
        payload: action.payload,
        ordinal,
        source: action.source,
      }
      const seen = new Set(state.seen)
      seen.add(key)

      const terminal: Terminal =
        action.kind === 'flow_done'
          ? 'done'
          : action.kind === 'flow_err'
            ? 'error'
            : state.terminal

      const outputs =
        action.kind === 'flow_done' &&
        action.payload.outputs &&
        typeof action.payload.outputs === 'object'
          ? action.payload.outputs
          : state.outputs

      const error =
        action.kind === 'flow_err' && typeof action.payload.error === 'string'
          ? action.payload.error
          : state.error

      return {
        events: [...state.events, ev],
        seen,
        ordinals,
        nodeStatus: applyNodeStatus(state.nodeStatus, action.kind, node),
        terminal,
        outputs,
        error,
      }
    }
    default:
      return state
  }
}
