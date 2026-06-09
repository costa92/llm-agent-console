import { useMemo } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import type { NodeStatus } from '@/features/flow/timeline/reducer'
import {
  layoutGraph,
  type IrEdge,
  type IrNode,
} from '@/features/flow/timeline/layoutGraph'
import { FlowGraphNode, type FlowGraphNodeData } from './FlowGraphNode'

/**
 * The read-only execution graph (design "FlowGraph.tsx"): renders the flow's
 * topology (nodes + edges from the IR) colored by run status, with the live
 * `running` node highlighted. Replaces the flat NodeStatusList above the
 * timeline; the same `nodeStatus` map drives it for both live stream and replay.
 *
 * It is READ-ONLY: `nodesConnectable={false}`, no editing. Pan/zoom + minimap +
 * background grid are the only RF affordances. Nodes may still be dragged
 * (harmless reposition); `fitView` frames the graph on mount.
 *
 * Union rendering (design edge case): renders every IR node PLUS any node that
 * only appears in `nodeStatus` (a status-only node gets a default position
 * appended after the laid-out ranks) so the run view never hides a reported
 * node. A traversed edge (both endpoints done/running) is emphasized.
 */

export interface FlowGraphProps {
  /** The decoded flow IR — `{ nodes, edges }`. */
  ir: { nodes: IrNode[]; edges: IrEdge[] }
  /** The reducer's per-node status map (node id → status). */
  nodeStatus: Record<string, NodeStatus>
}

/** Register the custom node once (stable identity — avoids RF re-mount warns). */
const nodeTypes = { flowNode: FlowGraphNode }

/** Default position for a status-only node (after the laid-out ranks). */
const ORPHAN_X = 0
const ORPHAN_Y_STEP = 90

export function FlowGraph({ ir, nodeStatus }: FlowGraphProps) {
  const { rfNodes, rfEdges } = useMemo(() => {
    const irNodes = ir.nodes ?? []
    const irEdges = ir.edges ?? []
    const { nodes: positioned, edges } = layoutGraph(irNodes, irEdges)

    const placed = new Set(positioned.map((n) => n.id))
    // The lowest y so orphans stack below the laid-out graph, not on top of it.
    const maxY = positioned.reduce((m, n) => Math.max(m, n.y), 0)

    const nodes: Node<FlowGraphNodeData>[] = positioned.map((p) => ({
      id: p.id,
      type: 'flowNode',
      position: { x: p.x, y: p.y },
      data: { label: p.id, status: nodeStatus[p.id] },
    }))

    // Status-only nodes (in nodeStatus, not in the IR) → render the union.
    let orphanIdx = 0
    for (const id of Object.keys(nodeStatus)) {
      if (placed.has(id)) continue
      nodes.push({
        id,
        type: 'flowNode',
        position: {
          x: ORPHAN_X,
          y: maxY + ORPHAN_Y_STEP * (orphanIdx + 1),
        },
        data: { label: id, status: nodeStatus[id] },
      })
      orphanIdx += 1
    }

    // Emphasize traversed edges — both endpoints reached (done | running).
    const traversed = (id: string) => {
      const s = nodeStatus[id]
      return s === 'done' || s === 'running'
    }
    const rfEdges: Edge[] = edges.map((e) => {
      const active = traversed(e.source) && traversed(e.target)
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        animated: active,
        style: {
          stroke: active ? 'var(--status-up)' : 'var(--border)',
          strokeWidth: active ? 2 : 1,
        },
      }
    })

    return { rfNodes: nodes, rfEdges }
  }, [ir, nodeStatus])

  return (
    <section
      aria-label="Execution graph"
      data-slot="flow-graph"
      className="overflow-hidden rounded-md border"
      style={{ borderColor: 'var(--border)', background: 'var(--card)', height: 320 }}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </section>
  )
}
