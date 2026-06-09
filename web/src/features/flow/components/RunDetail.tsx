import { useEffect, useRef } from 'react'
import { RotateCcw } from 'lucide-react'

import { CopyableId } from '@/components/primitives/CopyableId'
import { FiveStateWrapper } from '@/components/primitives/FiveStateWrapper'
import { RawJsonViewer } from '@/components/primitives/RawJsonViewer'
import { Button } from '@/components/ui/button'
import {
  useRunQuery,
  useRunEventsQuery,
  useFlowQuery,
} from '@/features/flow/api/queries'
import { FlowdError } from '@/features/flow/api/client'
import type { DecodedFlowRecord } from '@/features/flow/api/client'
import { useRunStream } from '@/features/flow/timeline/useRunStream'
import type { NodeStatus } from '@/features/flow/timeline/reducer'
import type {
  IrEdge,
  IrNode,
} from '@/features/flow/timeline/layoutGraph'
import type { RunRecord } from '@/features/flow/api/schemas'
import { RunStatusBadge } from './RunsHistory'
import { TimelineView } from './TimelineView'
import { RunResultPanel } from './RunResultPanel'
import { FlowGraph } from './FlowGraph'
import { NodeStatusList } from './NodeStatusList'

/**
 * Run detail (S8 / FLOW-05/06 / D-07 / D-08 / IC-7) — the body of the run
 * sub-route `/flows/{id}/runs/{runId}`, the SINGLE render location for BOTH live
 * runs and replays.
 *
 * It does two things over ONE timeline renderer:
 *
 *   1. SUMMARY — `getRun(runId)` (via useRunQuery, five-state) renders the run's
 *      status badge (Color (d), the SAME badge as the history table) + started /
 *      finished timestamps + inputs/outputs/error through the raw-JSON viewer.
 *
 *   2. TIMELINE — the Plan-04 TimelineView + (its embedded NodeStatusList +
 *      ConnectionBadge) + RunResultPanel, fed by the Plan-03 useRunStream hook —
 *      the SAME reducer/renderer for live and replay (success criterion 5):
 *        - TERMINAL run (done/failed) → `replay(runId)` INSTANT-FILLS the
 *          timeline (mode='replay', no auto-scroll animation); the persisted
 *          frames re-stream through the SAME reducer so the rendered timeline is
 *          identical to a live run of the same frames. The terminal flow_done
 *          outputs / flow_err error land in the RunResultPanel.
 *        - RUNNING run → re-stream the persisted events-so-far through the same
 *          reducer (de-dup makes a deep-link mid-run safe) with ConnectionBadge
 *          'Streaming' + auto-scroll active (mode='live'); the D-09 Retry is
 *          wired to the hook's `retry()` (the /events-hydrate recovery, NOT a
 *          fresh /run/stream).
 *
 * Empty `/events` (a run that recorded no events — 200 {events:[]}) → the "No
 * events recorded." empty state, NOT an error (RESEARCH Pitfall 7): the replay
 * settles with zero folded frames.
 *
 * Replay CTA is hidden/disabled while the run status is 'running' (a running run
 * already shows the live stream — Non-Blocking Rec #4).
 *
 * All flowd strings (status, timestamps, inputs/outputs/error, frame payloads)
 * render as TEXT nodes / escaped raw-JSON (T-03-V5).
 */
export interface RunDetailProps {
  flowId: string
  runId: string
}

export function RunDetail({ flowId, runId }: RunDetailProps) {
  const runQuery = useRunQuery(runId)
  const rec = runQuery.data

  const err = runQuery.error
  const errorState =
    err != null
      ? {
          status: err instanceof FlowdError ? err.status : undefined,
          service: 'flowd',
          message: err instanceof Error ? err.message : 'request failed',
        }
      : null

  return (
    <FiveStateWrapper
      loading={runQuery.isLoading}
      error={errorState}
      onRetry={() => void runQuery.refetch()}
    >
      {rec != null && (
        <RunDetailBody flowId={flowId} runId={runId} rec={rec} />
      )}
    </FiveStateWrapper>
  )
}

function RunDetailBody({
  flowId,
  runId,
  rec,
}: {
  flowId: string
  runId: string
  rec: RunRecord
}) {
  const stream = useRunStream()
  const isRunning = rec.status === 'running'
  // A terminal run instant-fills (no playback animation); a running run tails
  // live (auto-scroll follows the newest frame).
  const mode: 'live' | 'replay' = isRunning ? 'live' : 'replay'

  // Authoritative events probe (Pitfall 7): GET /runs/{id}/events returns []
  // for a run that recorded no events (200 {events:[]}) — a VALID empty state,
  // NOT an error. This REST read gives the deterministic empty/has-events signal
  // (the SSE replay's clean close does not, on its own, distinguish "ended" from
  // "ended empty"). The reducer de-dup makes the parallel replay safe.
  const eventsQuery = useRunEventsQuery(runId)
  const hasEvents = (eventsQuery.data?.length ?? 0) > 0
  const noEvents = eventsQuery.isSuccess && !hasEvents

  // Once we know the run HAS persisted events, fold them through the SAME reducer
  // the live path uses. `replay(runId)` re-streams the persisted frames as
  // history (source:'history') — instant-fill for a terminal run, the
  // events-so-far for a running one; the (kind,node,ordinal) de-dup keeps a
  // mid-run deep-link from doubling. Guard so React 19 StrictMode's double-mount
  // (and the query settling) does not open the stream twice.
  const startedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!hasEvents) return
    if (startedRef.current === runId) return
    startedRef.current = runId
    stream.replay(runId)
  }, [runId, hasEvents, stream])

  const { timeline, conn, attempt, cap } = stream

  // Topology source (no backend change): the decoded flow IR `{ nodes, edges }`.
  // On success the execution graph replaces the flat NodeStatusList; on error we
  // fall back to NodeStatusList so the run view never regresses.
  const flowQuery = useFlowQuery(flowId)

  return (
    <div className="flex flex-col gap-6">
      {/* ── Run summary ─────────────────────────────────────────────────── */}
      <section
        aria-label="Run summary"
        className="flex flex-col gap-4 rounded-md border p-4"
        style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
      >
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CopyableId id={runId} />
          </div>
          <div className="flex items-center gap-2">
            {/* The SAME run-status badge as the history table (Color (d)). */}
            <RunStatusBadge status={rec.status} />
            {/* Replay CTA — instant-fills the timeline again from persisted
                events. Only meaningful for a TERMINAL run; hidden while running
                (a running run already shows the live stream — Non-Blocking
                Rec #4). */}
            {!isRunning && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => {
                  startedRef.current = runId
                  stream.replay(runId)
                }}
              >
                <RotateCcw className="size-3.5" aria-hidden />
                Replay
              </Button>
            )}
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex flex-col gap-0.5">
            <dt
              className="text-xs font-semibold uppercase tracking-[0.04em]"
              style={{ color: 'var(--muted-foreground)' }}
            >
              started_at
            </dt>
            <dd className="mono" style={{ color: 'var(--foreground)' }}>
              {rec.started_at}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt
              className="text-xs font-semibold uppercase tracking-[0.04em]"
              style={{ color: 'var(--muted-foreground)' }}
            >
              finished_at
            </dt>
            <dd className="mono" style={{ color: 'var(--foreground)' }}>
              {/* Omitted while running → "—". */}
              {rec.finished_at ?? '—'}
            </dd>
          </div>
        </dl>

        {/* inputs / outputs / error via the raw-JSON viewer (collapsed). */}
        {rec.inputs != null && (
          <RawJsonViewer data={rec.inputs} label="Inputs" />
        )}
        {rec.outputs != null && (
          <RawJsonViewer data={rec.outputs} label="Outputs" />
        )}
        {rec.error != null && (
          <p
            className="mono text-sm"
            style={{ color: 'var(--status-down)' }}
            data-slot="run-error"
          >
            {rec.error}
          </p>
        )}
      </section>

      {/* ── Execution graph (topology + live position) above the timeline ──
          Replaces the flat NodeStatusList: react-flow renders the flow's
          nodes/edges colored by the SAME reducer nodeStatus (live + replay),
          with the running node highlighted. Pending → compact skeleton; error
          → NodeStatusList fallback so the run view never regresses. */}
      <FlowGraphSlot flowQuery={flowQuery} nodeStatus={timeline.nodeStatus} />

      {/* ── The SINGLE live+replay timeline renderer (S5 / S8 / D-08) ────── */}
      {noEvents ? (
        <NoEventsEmptyState />
      ) : (
        <>
          <TimelineView
            timeline={timeline}
            conn={conn}
            mode={mode}
            // 05-04 D-04: thread attempt/cap from useRunStream so ConnectionBadge
            // renders "Reconnecting (n/N)…" and the reconnecting subline shows
            // the counter. Zero when not reconnecting (idle value from useRunStream).
            attempt={attempt}
            cap={cap}
            // D-09: the AMBER "Connection lost" Retry wires to the hook's retry()
            // — the /events-hydrate recovery for the KNOWN runId, de-duped, NOT a
            // fresh /run/stream POST.
            onRetry={() => void stream.retry()}
          />

          {/* The ONE result surface (D-04): the terminal flow_done outputs /
              flow_err error fold here from the SAME reducer. */}
          <RunResultPanel
            outputs={timeline.outputs}
            error={timeline.terminal === 'error' ? timeline.error : undefined}
          />
        </>
      )}
    </div>
  )
}

/** The flow IR topology shape the graph consumes. */
type FlowIr = { nodes: IrNode[]; edges: IrEdge[] }

/**
 * Narrow the decoded flow record's `flow` (typed `unknown`) to `{ nodes, edges }`.
 * Tolerant of a missing/empty `edges` (an editor skeleton or a node-only flow):
 * defaults to `[]`. Returns null only when there is no usable node list, so the
 * caller falls back to the strip rather than render an empty graph.
 */
function extractIr(rec: DecodedFlowRecord | undefined): FlowIr | null {
  const flow = rec?.flow
  if (flow == null || typeof flow !== 'object') return null
  const obj = flow as { nodes?: unknown; edges?: unknown }
  if (!Array.isArray(obj.nodes)) return null
  const nodes = obj.nodes as IrNode[]
  const edges = Array.isArray(obj.edges) ? (obj.edges as IrEdge[]) : []
  return { nodes, edges }
}

/**
 * The execution-graph slot above the timeline. Five-state-lite over the flow IR
 * query: success+parseable → <FlowGraph>; pending → compact skeleton; error (or
 * unparseable IR) → <NodeStatusList> fallback so the run view never regresses.
 */
function FlowGraphSlot({
  flowQuery,
  nodeStatus,
}: {
  flowQuery: ReturnType<typeof useFlowQuery>
  nodeStatus: Record<string, NodeStatus>
}) {
  if (flowQuery.isPending) {
    return (
      <div
        aria-label="Loading execution graph"
        data-slot="flow-graph-skeleton"
        className="animate-pulse rounded-md border"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--card)',
          height: 320,
        }}
      />
    )
  }

  const ir = extractIr(flowQuery.data)
  if (flowQuery.isError || ir == null) {
    // IR unavailable → keep the flat strip so the operator still sees status.
    return <NodeStatusList nodeStatus={nodeStatus} />
  }

  return <FlowGraph ir={ir} nodeStatus={nodeStatus} />
}

/** No-events empty state (UI-SPEC copy): "No events recorded." (Pitfall 7). */
function NoEventsEmptyState() {
  return (
    <section
      aria-label="Run timeline"
      className="flex flex-col items-center justify-center gap-2 rounded-md border py-16 text-center"
      style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
    >
      <h3
        className="text-base font-semibold"
        style={{ color: 'var(--foreground)' }}
      >
        No events recorded.
      </h3>
      <p className="max-w-md text-sm" style={{ color: 'var(--muted-foreground)' }}>
        This run produced no events.
      </p>
    </section>
  )
}
