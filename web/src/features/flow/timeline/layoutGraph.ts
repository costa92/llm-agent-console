/**
 * Pure topological LAYERED layout for the flow execution graph (no React, no
 * react-flow). Flows are small DAGs, so a hand-rolled longest-path layering
 * beats a dagre/elk dependency (design decision: "Custom layered layout").
 *
 * Layout convention: ranks flow LEFT→RIGHT (x grows with rank — longest path
 * from a source), siblings within a rank spread TOP→BOTTOM (y grows with the
 * sibling index). A node with no incoming edge is a source at rank 0.
 *
 * Robustness (design "Error handling / edge cases"):
 *   - Unknown edges (an endpoint not in `nodes`) are tolerated: they neither
 *     create phantom nodes nor crash; they simply do not influence ranking.
 *   - Cycles are tolerated: ranking is a bounded longest-path relaxation
 *     (`|nodes|` passes max), so a cycle cannot loop forever.
 *   - Empty / single-node flows lay out without edges.
 */

/** A flow IR node — only `id` matters to the layout. */
export interface IrNode {
  id: string
  type?: string
  config?: unknown
}

/** A flow IR edge: `{ source: {node,port}, target: {node,port} }`. */
export interface IrEdge {
  source: { node: string; port?: string }
  target: { node: string; port?: string }
}

/** A node placed at a pixel position. */
export interface PositionedNode {
  id: string
  x: number
  y: number
}

/** A normalized edge (node-id → node-id), stable id for react-flow. */
export interface NormalizedEdge {
  id: string
  source: string
  target: string
}

export interface GraphLayout {
  nodes: PositionedNode[]
  edges: NormalizedEdge[]
}

/** Horizontal gap between ranks (px). */
const RANK_X = 220
/** Vertical gap between siblings within a rank (px). */
const SIBLING_Y = 90

/**
 * Compute positioned nodes + normalized edges from a flow IR.
 *
 * @param nodes IR nodes (`{ id, ... }`).
 * @param edges IR edges (`{ source:{node}, target:{node} }`).
 */
export function layoutGraph(
  nodes: readonly IrNode[],
  edges: readonly IrEdge[],
): GraphLayout {
  const ids = nodes.map((n) => n.id)
  const known = new Set(ids)

  // Keep only edges whose BOTH endpoints are real nodes (unknown-edge tolerance).
  const realEdges = edges.filter(
    (e) => known.has(e.source?.node) && known.has(e.target?.node),
  )

  // rank[id] = longest path length from any source. Start every node at 0;
  // relax over edges up to |nodes| times. A cycle just stops improving once the
  // bound is hit, so the loop always terminates.
  const rank = new Map<string, number>()
  for (const id of ids) rank.set(id, 0)

  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false
    for (const e of realEdges) {
      const sr = rank.get(e.source.node) ?? 0
      const tr = rank.get(e.target.node) ?? 0
      if (tr < sr + 1) {
        rank.set(e.target.node, sr + 1)
        changed = true
      }
    }
    if (!changed) break
  }

  // Bucket nodes by rank, preserving IR order for stable sibling placement.
  const byRank = new Map<number, string[]>()
  for (const id of ids) {
    const r = rank.get(id) ?? 0
    const bucket = byRank.get(r)
    if (bucket) bucket.push(id)
    else byRank.set(r, [id])
  }

  const positioned: PositionedNode[] = []
  for (const [r, bucket] of byRank) {
    bucket.forEach((id, i) => {
      positioned.push({ id, x: r * RANK_X, y: i * SIBLING_Y })
    })
  }
  // Stable output order = IR order (the byRank map iterates in insertion order
  // but interleaves ranks; re-sort to IR order so callers/tests are stable).
  const order = new Map(ids.map((id, i) => [id, i]))
  positioned.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))

  const normalizedEdges: NormalizedEdge[] = realEdges.map((e) => ({
    id: `${e.source.node}->${e.target.node}`,
    source: e.source.node,
    target: e.target.node,
  }))

  return { nodes: positioned, edges: normalizedEdges }
}
