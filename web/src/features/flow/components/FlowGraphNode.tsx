import { Handle, Position, type NodeProps } from '@xyflow/react'

import type { NodeStatus } from '@/features/flow/timeline/reducer'
import { STATUS_META } from './flowGraphStatus'

/**
 * Custom react-flow node for the execution graph: a small dark box showing the
 * flow node id (as TEXT — flowd identifier, never markup, T-03-V5) plus its
 * status icon + color from the shared STATUS_META. When the node is the live
 * `running` position (`current` emphasis) it gets a pulsing ring so the operator
 * can spot "where execution is now" at a glance.
 *
 * The node is read-only: connection handles are present (so edges attach) but
 * hidden + non-interactive (`<ReactFlow nodesConnectable={false}>`).
 */

export interface FlowGraphNodeData {
  /** The flow node id (rendered label). */
  label: string
  /** The run status driving color/icon; `undefined` → render as neutral. */
  status?: NodeStatus
  [key: string]: unknown
}

/** Hidden connection handle — present for edge attachment, never interactive. */
const HANDLE_STYLE = { opacity: 0, width: 1, height: 1, border: 'none' } as const

export function FlowGraphNode({ data }: NodeProps) {
  const { label, status } = data as FlowGraphNodeData
  const meta = status ? STATUS_META[status] : undefined
  const token = meta?.token ?? 'var(--muted-foreground)'
  const Icon = meta?.Icon
  const isCurrent = meta?.current ?? false

  return (
    <div
      data-slot="flow-graph-node"
      data-node={label}
      data-status={status ?? 'unknown'}
      data-current={isCurrent ? 'true' : undefined}
      className={
        isCurrent
          ? 'flex items-center gap-2 rounded-md border px-3 py-2 text-xs animate-pulse'
          : 'flex items-center gap-2 rounded-md border px-3 py-2 text-xs'
      }
      style={{
        background: 'var(--card)',
        borderColor: token,
        // The pulsing ring on the live current node (running).
        boxShadow: isCurrent ? `0 0 0 3px ${token}` : undefined,
        opacity: meta?.dim ? 0.6 : 1,
        color: 'var(--card-foreground)',
        minWidth: 120,
      }}
    >
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} isConnectable={false} />
      {Icon ? (
        <Icon
          className={meta?.spin ? 'size-3.5 animate-spin' : 'size-3.5'}
          style={{ color: token }}
          aria-hidden
        />
      ) : null}
      <span className="mono" style={{ color: 'var(--foreground)' }}>
        {label}
      </span>
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} isConnectable={false} />
    </div>
  )
}
