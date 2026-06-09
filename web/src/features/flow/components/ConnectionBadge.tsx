import { CircleCheck, Loader, Radio, Unplug } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import type { ConnState } from '@/features/flow/timeline/connection'

/**
 * Connection-state badge (S6 / D-02 / D-09) — the TRANSPORT signal in the
 * timeline header. UI-SPEC Color table (c): each state pairs color + icon + text
 * so it never relies on color alone (color-blind safe).
 *
 * The operator-critical D-09 distinction lives in the COLOR + LOCATION: this
 * badge in the HEADER goes AMBER ("Connection lost") on a transport drop — a
 * RECOVERABLE state. A `flow_err` (the flow actually failed) is RED, in the
 * timeline BODY (see TimelineView), never here. `closed` is NEUTRAL — the stream
 * ended cleanly; whether the run SUCCEEDED is the terminal frame's job.
 *
 * `idle` (no run yet) renders nothing — the badge only appears once a stream has
 * opened.
 *
 * 05-03 D-03: `reconnecting` arm renders amber spinner + "(n/N)…" counter when
 * `attempt`/`cap` props are provided (UI-SPEC NBR-3). Without counts it renders
 * "Reconnecting…". Distinct from static "Connection lost" (errored — no spinner).
 */

const STATE_META: Record<
  Exclude<ConnState, 'idle'>,
  { token: string; label: string; Icon: typeof Loader }
> = {
  streaming: {
    token: 'var(--status-up)', // GREEN — stream open, frames arriving
    label: 'Streaming',
    Icon: Radio,
  },
  reconnecting: {
    token: 'var(--status-degraded)', // AMBER — in-progress recovery (Phase 5 D-03)
    label: 'Reconnecting',
    Icon: Loader,                   // SPINNER — distinguishes from static Unplug
  },
  closed: {
    token: 'var(--status-unknown)', // NEUTRAL — stream cleanly ended
    label: 'Closed',
    Icon: CircleCheck,
  },
  errored: {
    token: 'var(--status-degraded)', // AMBER — gave up, manual retry available (D-09)
    label: 'Connection lost',
    Icon: Unplug,
  },
}

export interface ConnectionBadgeProps {
  conn: ConnState
  /**
   * Current reconnect attempt (1-based), e.g. 2 → renders "(2/N)…".
   * Only meaningful when conn === 'reconnecting'. Pass undefined to omit the counter.
   * UI-SPEC NBR-3: counter is optional — bare "Reconnecting…" when absent.
   */
  attempt?: number
  /**
   * Max reconnect attempts (cap), e.g. 5. Combined with attempt to render "(n/N)…".
   * Only meaningful when conn === 'reconnecting' and attempt is provided.
   */
  cap?: number
}

export function ConnectionBadge({ conn, attempt, cap }: ConnectionBadgeProps) {
  if (conn === 'idle') return null
  const meta = STATE_META[conn]
  // streaming and reconnecting both spin a Loader icon (05-RESEARCH Pattern 5)
  const Icon = conn === 'streaming' || conn === 'reconnecting' ? Loader : meta.Icon
  const spinning = conn === 'streaming' || conn === 'reconnecting'

  // Build the label: "Reconnecting (n/N)…" when conn=reconnecting + counts present.
  let label = meta.label
  if (conn === 'reconnecting') {
    if (attempt !== undefined && cap !== undefined) {
      label = `Reconnecting (${attempt}/${cap})…`
    } else {
      label = 'Reconnecting…'
    }
  }

  return (
    <Badge
      variant="outline"
      data-conn={conn}
      style={{
        color: meta.token,
        borderColor: meta.token,
        background: 'color-mix(in oklch, ' + meta.token + ' 12%, transparent)',
      }}
    >
      <Icon
        className={spinning ? 'size-3.5 animate-spin' : 'size-3.5'}
        aria-hidden
      />
      {label}
    </Badge>
  )
}
