import { useEffect, useRef } from 'react'
import { RotateCcw } from 'lucide-react'

import { CopyableId } from '@/components/primitives/CopyableId'
import { FiveStateWrapper } from '@/components/primitives/FiveStateWrapper'
import { RawJsonViewer } from '@/components/primitives/RawJsonViewer'
import { Button } from '@/components/ui/button'
import { useRunQuery, useRunEventsQuery } from '@/features/flow/api/queries'
import { FlowdError } from '@/features/flow/api/client'
import { useRunStream } from '@/features/flow/timeline/useRunStream'
import type { RunRecord } from '@/features/flow/api/schemas'
import { RunStatusBadge } from './RunsHistory'
import { TimelineView } from './TimelineView'
import { RunResultPanel } from './RunResultPanel'

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

export function RunDetail({ runId }: RunDetailProps) {
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
      {rec != null && <RunDetailBody runId={runId} rec={rec} />}
    </FiveStateWrapper>
  )
}

function RunDetailBody({ runId, rec }: { runId: string; rec: RunRecord }) {
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

  const { timeline, conn } = stream

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

      {/* ── The SINGLE live+replay timeline renderer (S5 / S8 / D-08) ────── */}
      {noEvents ? (
        <NoEventsEmptyState />
      ) : (
        <>
          <TimelineView
            timeline={timeline}
            conn={conn}
            mode={mode}
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
