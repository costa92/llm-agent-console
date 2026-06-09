import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  CheckCircle,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Play,
  XCircle,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { RawJsonViewer } from '@/components/primitives/RawJsonViewer'
import type { SseKind } from '@/features/flow/api/schemas'
import type { ConnState } from '@/features/flow/timeline/connection'
import type { Timeline, TimelineEvent } from '@/features/flow/timeline/reducer'
import { ConnectionBadge } from './ConnectionBadge'
import { NodeStatusList } from './NodeStatusList'

/**
 * The live append-only timeline (S5 / IC-3 — THE KEYSTONE renderer). It renders
 * the Plan-03 reducer model (`timeline.events` + `nodeStatus` + `terminal`) and
 * the connection-state badge; it owns the operator-critical D-09 distinction:
 *
 *   - `flow_err` is a TERMINAL frame → a RED row IN the timeline BODY
 *     ("Flow failed — {error}."), with the partial timeline ABOVE it kept
 *     visible. The flow genuinely failed; re-running is a fresh Run, NOT a
 *     reconnect — so NO Retry here.
 *   - `conn === 'errored'` (a transport drop, NO terminal frame) → the AMBER
 *     "Connection lost" badge in the HEADER + a muted reconnect line + a Retry
 *     button that calls `onRetry` (the parent wires it to the Plan-03 hook's
 *     `retry()`, which hydrates GET /runs/{id}/events for the KNOWN runId and
 *     de-dups — NOT a fresh /run/stream POST that would start a new run).
 *
 * Auto-scroll-pause (D-03): while live and at-bottom, follow the newest frame;
 * on a manual scroll-up, pause + show the accent "Jump to latest" pill; clicking
 * it scrolls to newest and resumes. `mode="replay"` disables following (instant
 * fill — Plan 05). jsdom has no layout, so following is driven off scroll
 * geometry and the scroll target's `scrollIntoView` (stubbed in tests; we assert
 * intent, not pixels).
 *
 * All flowd payload strings (node names, error, payloads) render as TEXT nodes
 * (T-03-V5: no dangerouslySetInnerHTML anywhere).
 */

const FRAME_META: Record<
  SseKind,
  { token: string; Icon: typeof Play; spin?: boolean; label: string }
> = {
  flow_started: {
    token: 'var(--status-unknown)', // neutral slate (recommended over blue)
    Icon: Play,
    label: 'Flow started',
  },
  node_started: {
    token: 'var(--status-unknown)',
    Icon: CircleDashed,
    label: 'Node started',
  },
  node_finished: {
    token: 'var(--status-up)',
    Icon: CheckCircle,
    label: 'Node finished',
  },
  node_skipped: {
    token: 'var(--status-unknown)',
    Icon: CircleSlash,
    label: 'Node skipped',
  },
  flow_done: {
    token: 'var(--status-up)',
    Icon: CheckCircle2,
    label: 'Flow done',
  },
  flow_err: {
    token: 'var(--status-down)', // RED — terminal failure, in-body (D-09)
    Icon: XCircle,
    label: 'Flow failed',
  },
}

export interface TimelineViewProps {
  /** The Plan-03 reducer render model. */
  timeline: Timeline
  /** The transport connection state (Plan-03 connection machine). */
  conn: ConnState
  /**
   * D-09 transport-drop recovery — wired by the parent to the hook's `retry()`
   * (hydrates GET /events for the known runId; NOT a new run). Only invoked from
   * the AMBER "Connection lost" header state.
   */
  onRetry?: () => void
  /**
   * 'live' (default) follows the newest frame with auto-scroll-pause; 'replay'
   * instant-fills with NO following (Plan 05 sets this).
   */
  mode?: 'live' | 'replay'
  /**
   * 05-04 IC-4 overlay: current reconnect attempt (1-based; 0 when idle).
   * Forwarded into ConnectionBadge for the "(n/N)…" counter.
   * Also used in the reconnecting subline copy.
   */
  attempt?: number
  /**
   * 05-04 IC-4 overlay: max reconnect attempts (cap). Forwarded into
   * ConnectionBadge and the reconnecting subline copy.
   */
  cap?: number
}

/** Is this frame the live tail of a still-running node (spin its icon)? */
function isLiveTail(
  ev: TimelineEvent,
  index: number,
  events: TimelineEvent[],
  terminal: Timeline['terminal'],
): boolean {
  if (terminal !== 'none') return false
  if (ev.kind !== 'node_started') return false
  // Spin while no later frame has finished/skipped this same node.
  for (let i = index + 1; i < events.length; i++) {
    const later = events[i]
    if (
      later.node === ev.node &&
      (later.kind === 'node_finished' || later.kind === 'node_skipped')
    ) {
      return false
    }
  }
  return true
}

export function TimelineView({
  timeline,
  conn,
  onRetry,
  mode = 'live',
  attempt,
  cap,
}: TimelineViewProps) {
  const { events, nodeStatus, terminal, error } = timeline
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [paused, setPaused] = useState(false)

  // Follow the newest frame while live + not paused (D-03). Skipped entirely in
  // replay mode (instant fill). We assert INTENT in tests (scrollIntoView is
  // stubbed; jsdom has no layout).
  useLayoutEffect(() => {
    if (mode === 'replay') return
    if (paused) return
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [events.length, paused, mode])

  // Manual scroll-up pauses following; returning to the bottom resumes.
  useEffect(() => {
    if (mode === 'replay') return
    const el = scrollRef.current
    if (!el) return
    function onScroll() {
      const node = scrollRef.current
      if (!node) return
      const atBottom =
        node.scrollHeight - node.scrollTop - node.clientHeight <= 4
      setPaused(!atBottom)
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [mode])

  function jumpToLatest() {
    setPaused(false)
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }

  return (
    <section
      aria-label="Event timeline"
      className="flex flex-col gap-4 rounded-md border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
      data-mode={mode}
    >
      {/* Header: panel title + the connection-state badge (D-02). */}
      <header className="flex items-center justify-between gap-2">
        <h2
          className="text-base font-semibold"
          style={{ color: 'var(--foreground)' }}
        >
          Timeline
        </h2>
        {/* 05-04 IC-4: forward attempt/cap so the badge renders
            "Reconnecting (n/N)…" during a transport drop. */}
        <ConnectionBadge conn={conn} attempt={attempt} cap={cap} />
      </header>

      {/* Per-node status strip (D-01) — fed by the SAME reducer. */}
      <NodeStatusList nodeStatus={nodeStatus} />

      {/* The append-only frame log. */}
      <div className="relative">
        <div
          ref={scrollRef}
          data-slot="timeline-scroll"
          className="relative max-h-96 overflow-auto pr-1"
        >
          {events.length === 0 ? (
            <p
              className="py-6 text-center text-sm"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Trigger a run to stream its event timeline.
            </p>
          ) : (
            <ol className="relative flex flex-col gap-2">
              {/* 1px neutral rail connecting the gutter icons. */}
              <span
                aria-hidden
                className="absolute top-2 bottom-2 left-[11px] w-px"
                style={{ background: 'var(--border)' }}
              />
              {events.map((ev, i) => (
                <FrameRow
                  key={`${ev.source}:${ev.kind}:${ev.node ?? ''}:${ev.ordinal}`}
                  event={ev}
                  spin={isLiveTail(ev, i, events, terminal)}
                  isError={ev.kind === 'flow_err'}
                  error={error}
                />
              ))}
            </ol>
          )}
          <div ref={bottomRef} data-slot="timeline-bottom" />
        </div>

        {/* Jump-to-latest pill — present ONLY while paused (D-03). */}
        {paused && mode === 'live' && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
            <Button
              type="button"
              size="sm"
              onClick={jumpToLatest}
              className="pointer-events-auto gap-1"
            >
              <ArrowDownToLine className="size-3.5" aria-hidden />
              Jump to latest
            </Button>
          </div>
        )}
      </div>

      {/* 05-04 IC-4: transient reconnecting overlay (partial timeline stays above).
          The badge already shows "Reconnecting (n/N)…" in the header; this muted
          subline below the timeline body confirms the drop is in progress.
          TEXT node — T-V5. */}
      {conn === 'reconnecting' && (
        <p
          className="text-sm"
          style={{ color: 'var(--muted-foreground)' }}
          data-slot="reconnecting-subline"
        >
          Connection dropped — reconnecting…
          {attempt !== undefined && cap !== undefined
            ? ` (attempt ${attempt} of ${cap}).`
            : '.'}
        </p>
      )}

      {/* D-09: transport drop → AMBER header state already shown by the badge;
          here we add the muted reconnect copy + the Retry (→ /events hydrate). */}
      {conn === 'errored' && (
        <div
          className="flex items-center justify-between gap-3 rounded-md border p-3"
          style={{
            borderColor: 'var(--status-degraded)',
            background:
              'color-mix(in oklch, var(--status-degraded) 8%, transparent)',
          }}
        >
          <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Connection dropped before the run finished — Retry to re-open the
            stream.
          </p>
          {onRetry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetry}
            >
              Retry
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

interface FrameRowProps {
  event: TimelineEvent
  spin: boolean
  isError: boolean
  error?: string
}

function FrameRow({ event, spin, isError, error }: FrameRowProps) {
  const meta = FRAME_META[event.kind]
  const Icon = meta.Icon
  return (
    <li className="relative flex gap-3 pl-0">
      {/* Gutter status icon (per-frame-kind color table (a)). */}
      <span
        className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full"
        style={{ background: 'var(--card)' }}
      >
        <Icon
          className={spin ? 'size-4 animate-spin' : 'size-4'}
          style={{ color: meta.token }}
          aria-hidden
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 pb-1">
        <div className="flex items-center gap-2">
          {/* Frame-kind label (sans Body). */}
          <span className="text-sm" style={{ color: 'var(--foreground)' }}>
            {meta.label}
          </span>
          {/* Mono node name when present — TEXT node (T-03-V5). */}
          {event.node && (
            <span
              className="mono text-xs"
              style={{ color: 'var(--muted-foreground)' }}
            >
              {event.node}
            </span>
          )}
        </div>

        {/* flow_err renders its error inline as the terminal row (D-09). The
            error string is a TEXT node, mono, RED. */}
        {isError && error && (
          <p
            className="mono text-sm"
            style={{ color: 'var(--status-down)' }}
            data-slot="flow-err-message"
          >
            Flow failed — {error}.
          </p>
        )}

        {/* Collapsed per-frame raw JSON over the payload (dense-log default). */}
        <RawJsonViewer data={event.payload} label="Payload" />
      </div>
    </li>
  )
}
