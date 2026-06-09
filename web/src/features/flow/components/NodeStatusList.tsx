import { Badge } from '@/components/ui/badge'
import type { NodeStatus } from '@/features/flow/timeline/reducer'
import { STATUS_META } from './flowGraphStatus'

/**
 * Per-node status strip (S5 / D-01) — a compact strip listing each node ONCE,
 * updating IN PLACE as frames arrive (driven by the SAME reducer as the
 * timeline). UI-SPEC Color table (b): each chip pairs color + icon + the node
 * name (mono) so state never relies on color alone.
 *
 *   pending  → muted, circle-dashed (known but not yet reached)
 *   running  → muted, spinning loader (the live node)
 *   done     → green, check-circle
 *   skipped  → muted, circle-slash, reduced-emphasis (0.6 opacity — inert branch)
 *   errored  → RED, x-circle (the failing node)
 *
 * Node names are flowd payload identifiers → rendered as TEXT nodes, mono
 * (T-03-V5: no markup ever interpolated).
 *
 * The status→token/icon mapping (STATUS_META) is shared with the execution
 * graph (`flowGraphStatus.ts`) so the strip and the graph node stay consistent.
 */

export interface NodeStatusListProps {
  /** The reducer's per-node status map (node name → status). */
  nodeStatus: Record<string, NodeStatus>
}

export function NodeStatusList({ nodeStatus }: NodeStatusListProps) {
  const nodes = Object.keys(nodeStatus)
  if (nodes.length === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
        No nodes reported yet.
      </p>
    )
  }
  return (
    <ul
      aria-label="Node status"
      className="flex flex-wrap gap-2"
      data-slot="node-status-list"
    >
      {nodes.map((node) => {
        const status = nodeStatus[node]
        const meta = STATUS_META[status]
        const Icon = meta.Icon
        return (
          <li key={node}>
            <Badge
              variant="outline"
              data-node={node}
              data-status={status}
              style={{
                color: meta.token,
                borderColor: meta.token,
                opacity: meta.dim ? 0.6 : 1,
              }}
            >
              <Icon
                className={meta.spin ? 'size-3.5 animate-spin' : 'size-3.5'}
                aria-hidden
              />
              <span className="mono">{node}</span>
            </Badge>
          </li>
        )
      })}
    </ul>
  )
}
