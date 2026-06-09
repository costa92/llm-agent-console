import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { NodeStatus } from '@/features/flow/timeline/reducer'
import { FlowGraph } from './FlowGraph'

const ir = {
  nodes: [{ id: 'upper' }, { id: 'reverse' }],
  edges: [{ source: { node: 'upper' }, target: { node: 'reverse' } }],
}

describe('FlowGraph', () => {
  it('renders both IR nodes with the current-position highlight on the running node', () => {
    const nodeStatus: Record<string, NodeStatus> = {
      upper: 'done',
      reverse: 'running',
    }
    render(<FlowGraph ir={ir} nodeStatus={nodeStatus} />)

    // Both node labels rendered (mono TEXT id).
    expect(screen.getByText('upper')).toBeInTheDocument()
    expect(screen.getByText('reverse')).toBeInTheDocument()

    // The running node carries the live current-position marker; done does not.
    const upper = document.querySelector('[data-slot="flow-graph-node"][data-node="upper"]')
    const reverse = document.querySelector('[data-slot="flow-graph-node"][data-node="reverse"]')
    expect(upper).toHaveAttribute('data-status', 'done')
    expect(upper).not.toHaveAttribute('data-current')
    expect(reverse).toHaveAttribute('data-status', 'running')
    expect(reverse).toHaveAttribute('data-current', 'true')
  })

  it('mounts the react-flow edges layer (edge geometry needs real DOM measure,', () => {
    // ...so under jsdom we assert the edges container is present and the graph
    // mounted; the upper->reverse edge production itself is covered exactly by
    // layoutGraph.test.ts — per the design's "keep the RF render test light".
    const { container } = render(
      <FlowGraph ir={ir} nodeStatus={{ upper: 'done', reverse: 'running' }} />,
    )
    expect(container.querySelector('.react-flow__edges')).not.toBeNull()
  })

  it('renders the union — a status-only node not in the IR still appears', () => {
    render(
      <FlowGraph
        ir={ir}
        nodeStatus={{ upper: 'done', reverse: 'done', ghost: 'pending' }}
      />,
    )
    expect(screen.getByText('ghost')).toBeInTheDocument()
  })

  it('renders without crashing for an empty flow', () => {
    const { container } = render(
      <FlowGraph ir={{ nodes: [], edges: [] }} nodeStatus={{}} />,
    )
    expect(container.querySelector('[data-slot="flow-graph"]')).not.toBeNull()
  })
})
