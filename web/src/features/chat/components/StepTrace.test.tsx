import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { StepTrace } from './StepTrace'
import type { StepRow } from '@/features/chat/turns/reducer'

/**
 * Component tests for StepTrace (04-03 Task 1 — the collapsible live step trace).
 *
 * StepTrace mirrors the Phase-3 frame-row PATTERN over chat `{kind,text}` step
 * rows: one row per step (gutter step-kind icon + label + the step `text` as a
 * TEXT node + a collapsed RawJsonViewer over the raw frame), all neutral slate
 * (done/error are terminal — handled by the page, not step rows). While
 * streaming the trace is EXPANDED with the live tail spinning + a
 * "Streaming steps…" summary; once settled it COLLAPSES to a "{N} steps"
 * clickable summary that re-expands the full trace.
 */

const twoSteps: StepRow[] = [
  { kind: 'thought', text: 'Looking up the order status…' },
  { kind: 'action', text: 'lookup_order(42)' },
]

describe('StepTrace — streaming (expanded + live tail)', () => {
  it('renders one row per step (label + text) expanded while streaming', () => {
    render(<StepTrace steps={twoSteps} status="streaming" />)
    // Both step texts visible (expanded).
    expect(screen.getByText('Looking up the order status…')).toBeInTheDocument()
    expect(screen.getByText('lookup_order(42)')).toBeInTheDocument()
    // Kind labels render.
    expect(screen.getByText('thought')).toBeInTheDocument()
    expect(screen.getByText('action')).toBeInTheDocument()
    // Streaming summary copy.
    expect(screen.getByText('Streaming steps…')).toBeInTheDocument()
  })

  it('spins the live tail (last) step icon while streaming', () => {
    const { container } = render(
      <StepTrace steps={twoSteps} status="streaming" />,
    )
    const spinners = container.querySelectorAll('.animate-spin')
    // Exactly the last row's gutter icon spins.
    expect(spinners.length).toBe(1)
  })
})

describe('StepTrace — settled (collapsed "{N} steps")', () => {
  it('collapses to a "{N} steps" summary on done (re-expandable)', () => {
    render(<StepTrace steps={twoSteps} status="done" />)
    // Collapsed summary shows the count; step texts are NOT shown until expanded.
    expect(screen.getByText('2 steps')).toBeInTheDocument()
    expect(
      screen.queryByText('Looking up the order status…'),
    ).not.toBeInTheDocument()

    // Click the summary → trace expands and the rows appear.
    fireEvent.click(screen.getByRole('button', { name: /2 steps/ }))
    expect(screen.getByText('Looking up the order status…')).toBeInTheDocument()
    expect(screen.getByText('lookup_order(42)')).toBeInTheDocument()
  })

  it('does not spin any icon once settled', () => {
    const { container } = render(<StepTrace steps={twoSteps} status="stopped" />)
    expect(container.querySelectorAll('.animate-spin').length).toBe(0)
  })
})

describe('StepTrace — unknown kind + empty', () => {
  it('renders an unknown step kind without crashing (circle fallback)', () => {
    const rows: StepRow[] = [{ kind: 'mystery', text: 'who knows' }]
    render(<StepTrace steps={rows} status="streaming" />)
    expect(screen.getByText('mystery')).toBeInTheDocument()
    expect(screen.getByText('who knows')).toBeInTheDocument()
  })

  it('renders nothing for empty steps', () => {
    const { container } = render(<StepTrace steps={[]} status="done" />)
    expect(container.firstChild).toBeNull()
  })
})
