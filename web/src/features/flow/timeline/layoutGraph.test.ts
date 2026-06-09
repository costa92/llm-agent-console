import { describe, expect, it } from 'vitest'

import { layoutGraph, type IrEdge, type IrNode } from './layoutGraph'

const edge = (s: string, t: string): IrEdge => ({
  source: { node: s },
  target: { node: t },
})

const rankOf = (nodes: { id: string; x: number }[], id: string) =>
  nodes.find((n) => n.id === id)?.x

describe('layoutGraph', () => {
  it('lays out a chain upper→reverse at ranks 0 and 1', () => {
    const nodes: IrNode[] = [{ id: 'upper' }, { id: 'reverse' }]
    const { nodes: out, edges } = layoutGraph(nodes, [edge('upper', 'reverse')])

    // upper is a source (rank 0, x=0); reverse is one hop later (rank 1, x>0).
    expect(rankOf(out, 'upper')).toBe(0)
    expect(rankOf(out, 'reverse')!).toBeGreaterThan(rankOf(out, 'upper')!)
    expect(edges).toEqual([
      { id: 'upper->reverse', source: 'upper', target: 'reverse' },
    ])
  })

  it('spreads branch siblings vertically within the same rank', () => {
    const nodes: IrNode[] = [
      { id: 'classify' },
      { id: 'greet' },
      { id: 'other' },
    ]
    const { nodes: out } = layoutGraph(nodes, [
      edge('classify', 'greet'),
      edge('classify', 'other'),
    ])

    const greet = out.find((n) => n.id === 'greet')!
    const other = out.find((n) => n.id === 'other')!
    // Both siblings share the rank-1 column...
    expect(greet.x).toBe(other.x)
    expect(greet.x).toBeGreaterThan(rankOf(out, 'classify')!)
    // ...but sit at different vertical positions (spread top→bottom).
    expect(greet.y).not.toBe(other.y)
  })

  it('tolerates an edge referencing a missing node (dropped, no crash)', () => {
    const nodes: IrNode[] = [{ id: 'a' }]
    const { nodes: out, edges } = layoutGraph(nodes, [edge('a', 'ghost')])

    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'a', x: 0 })
    // The ghost edge is neither rendered nor does it invent a node.
    expect(edges).toHaveLength(0)
  })

  it('terminates on a cycle (bounded relaxation)', () => {
    const nodes: IrNode[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const { nodes: out, edges } = layoutGraph(nodes, [
      edge('a', 'b'),
      edge('b', 'c'),
      edge('c', 'a'),
    ])

    // All three nodes still placed; edges all kept (each endpoint is real).
    expect(out).toHaveLength(3)
    expect(edges).toHaveLength(3)
    // Ranks are finite (no infinite blow-up): bounded by |nodes|.
    for (const n of out) expect(Number.isFinite(n.x)).toBe(true)
  })

  it('lays out a single-node flow with no edges, centered at the origin rank', () => {
    const { nodes: out, edges } = layoutGraph([{ id: 'solo' }], [])
    expect(out).toEqual([{ id: 'solo', x: 0, y: 0 }])
    expect(edges).toEqual([])
  })

  it('handles an empty flow', () => {
    expect(layoutGraph([], [])).toEqual({ nodes: [], edges: [] })
  })
})
