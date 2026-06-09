import { CheckCircle, CircleDashed, CircleSlash, Loader, XCircle } from 'lucide-react'

import type { NodeStatus } from '@/features/flow/timeline/reducer'

/**
 * The SINGLE source of truth mapping a per-node run `NodeStatus` to its visual
 * tokens (UI-SPEC Color table (b)). Both the flat strip (`NodeStatusList`) and
 * the execution-graph node (`FlowGraphNode`) read from here so they stay
 * visually consistent.
 *
 *   pending  → muted, circle-dashed (known but not yet reached)
 *   running  → muted, spinning loader + `current` emphasis (the LIVE node, gets
 *              a pulsing ring on the graph)
 *   done     → green, check-circle
 *   skipped  → muted, circle-slash, reduced-emphasis (dim — inert branch)
 *   errored  → RED, x-circle (the failing node)
 *
 * `spin`/`dim`/`current` are visual emphasis flags; the strip uses spin+dim, the
 * graph additionally uses `current` to draw the pulsing ring on the live node.
 */
export interface StatusMeta {
  token: string
  Icon: typeof Loader
  /** Spin the icon (running). */
  spin?: boolean
  /** Reduce emphasis to 0.6 opacity (skipped — inert branch). */
  dim?: boolean
  /** This is the live current position (running) — graph draws a pulsing ring. */
  current?: boolean
}

export const STATUS_META: Record<NodeStatus, StatusMeta> = {
  pending: { token: 'var(--status-unknown)', Icon: CircleDashed },
  running: { token: 'var(--status-unknown)', Icon: Loader, spin: true, current: true },
  done: { token: 'var(--status-up)', Icon: CheckCircle },
  skipped: { token: 'var(--status-unknown)', Icon: CircleSlash, dim: true },
  errored: { token: 'var(--status-down)', Icon: XCircle },
}
