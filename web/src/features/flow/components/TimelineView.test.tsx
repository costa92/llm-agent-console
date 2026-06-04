import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { TimelineView } from './TimelineView'
import {
  timelineReducer,
  initialTimeline,
  type Timeline,
} from '@/features/flow/timeline/reducer'
import type { SseKind, SsePayload } from '@/features/flow/api/schemas'

/**
 * Build a reducer render model from a golden frame sequence — TimelineView
 * renders the SAME model the live hook produces, so the test drives the real
 * reducer (not a hand-built object) to stay faithful to Plan 03.
 */
function fold(
  frames: Array<{ kind: SseKind; payload: SsePayload }>,
): Timeline {
  return frames.reduce<Timeline>(
    (state, f) =>
      timelineReducer(state, {
        type: 'event',
        source: 'live',
        kind: f.kind,
        payload: f.payload,
      }),
    initialTimeline,
  )
}

/** The golden SUCCESS sequence: flow_started → node ×2 → flow_done. */
const successFrames: Array<{ kind: SseKind; payload: SsePayload }> = [
  { kind: 'flow_started', payload: { flow: 'echo_chain' } },
  { kind: 'node_started', payload: { node: 'lower' } },
  { kind: 'node_finished', payload: { node: 'lower', output: 'hello' } },
  { kind: 'node_started', payload: { node: 'upper' } },
  { kind: 'node_finished', payload: { node: 'upper', output: 'HELLO' } },
  { kind: 'flow_done', payload: { outputs: { out: 'HELLO' } } },
]

/** The golden FAILURE sequence ending in flow_err (terminal, in-body). */
const failureFrames: Array<{ kind: SseKind; payload: SsePayload }> = [
  { kind: 'flow_started', payload: { flow: 'echo_chain' } },
  { kind: 'node_started', payload: { node: 'fetch' } },
  { kind: 'flow_err', payload: { node: 'fetch', error: 'node "fetch" timed out' } },
]

describe('TimelineView (S5 / IC-3 — the keystone renderer)', () => {
  beforeEach(() => {
    // jsdom has no layout — stub scrollIntoView so we can assert auto-scroll
    // INTENT (called/skipped), not pixels (03-VALIDATION auto-scroll note).
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders each frame as a row with its kind label + mono node name', () => {
    const timeline = fold(successFrames)
    render(<TimelineView timeline={timeline} conn="closed" />)

    expect(screen.getByText('Flow started')).toBeInTheDocument()
    expect(screen.getAllByText('Node started')).toHaveLength(2)
    expect(screen.getAllByText('Node finished')).toHaveLength(2)
    expect(screen.getByText('Flow done')).toBeInTheDocument()
    // Node names render (mono, in the rows).
    const log = screen.getByLabelText('Event timeline')
    expect(within(log).getAllByText('lower').length).toBeGreaterThanOrEqual(1)
    expect(within(log).getAllByText('upper').length).toBeGreaterThanOrEqual(1)
  })

  it('renders the per-node status strip from the reducer nodeStatus', () => {
    const timeline = fold(successFrames)
    render(<TimelineView timeline={timeline} conn="closed" />)

    const strip = screen.getByLabelText('Node status')
    // Both nodes appear in the strip, marked done (green check-circle chip).
    const lower = within(strip).getByText('lower').closest('[data-node]')
    const upper = within(strip).getByText('upper').closest('[data-node]')
    expect(lower).toHaveAttribute('data-status', 'done')
    expect(upper).toHaveAttribute('data-status', 'done')
  })

  it('shows the connection badge state in the header (streaming / closed / errored)', () => {
    const timeline = fold(successFrames)
    const { rerender } = render(
      <TimelineView timeline={timeline} conn="streaming" />,
    )
    expect(screen.getByText('Streaming')).toBeInTheDocument()

    rerender(<TimelineView timeline={timeline} conn="closed" />)
    expect(screen.getByText('Closed')).toBeInTheDocument()

    rerender(<TimelineView timeline={timeline} conn="errored" />)
    expect(screen.getByText('Connection lost')).toBeInTheDocument()
  })

  it('shows the idle/empty copy when there are no events', () => {
    render(<TimelineView timeline={initialTimeline} conn="idle" />)
    expect(
      screen.getByText('Trigger a run to stream its event timeline.'),
    ).toBeInTheDocument()
  })

  // ── D-09: flow_err (red, in-body) vs transport drop (amber, header) ────────

  it('renders flow_err as a RED terminal frame IN the body, keeping the partial timeline + NO Retry (D-09)', () => {
    const timeline = fold(failureFrames)
    const onRetry = vi.fn()
    render(
      <TimelineView timeline={timeline} conn="closed" onRetry={onRetry} />,
    )

    // The red in-body terminal message.
    const errMsg = screen.getByText(/Flow failed — node "fetch" timed out\./)
    expect(errMsg).toBeInTheDocument()
    // The partial timeline above it stays visible.
    expect(screen.getByText('Flow started')).toBeInTheDocument()
    expect(screen.getByText('Node started')).toBeInTheDocument()
    // A flow failure is NOT a transport drop: NO Retry, NO "Connection lost".
    expect(screen.queryByText('Connection lost')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument()
  })

  it('renders a transport drop as the AMBER "Connection lost" header + a Retry that calls onRetry (D-09)', () => {
    // A partial timeline with NO terminal frame, conn errored.
    const timeline = fold([
      { kind: 'flow_started', payload: { flow: 'echo_chain' } },
      { kind: 'node_started', payload: { node: 'slow' } },
    ])
    const onRetry = vi.fn()
    render(
      <TimelineView timeline={timeline} conn="errored" onRetry={onRetry} />,
    )

    // Amber header badge.
    expect(screen.getByText('Connection lost')).toBeInTheDocument()
    // The partial timeline stays visible.
    expect(screen.getByText('Flow started')).toBeInTheDocument()
    // Retry calls onRetry (the parent wires it to the hook's /events-hydrate retry()).
    const retry = screen.getByRole('button', { name: 'Retry' })
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
    // It is NOT a flow failure: no in-body "Flow failed" message.
    expect(screen.queryByText(/Flow failed —/)).not.toBeInTheDocument()
  })

  // ── Auto-scroll-pause intent (D-03) ────────────────────────────────────────

  it('follows the newest frame (scrollIntoView called) while live + not paused', () => {
    const { rerender } = render(
      <TimelineView timeline={fold([successFrames[0]])} conn="streaming" />,
    )
    ;(Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear()

    // A new frame arrives → follow (scrollIntoView intent fires).
    rerender(
      <TimelineView
        timeline={fold(successFrames.slice(0, 2))}
        conn="streaming"
      />,
    )
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('PAUSES following after a manual scroll-up (scrollIntoView skipped) until Jump-to-latest resumes', () => {
    const { rerender } = render(
      <TimelineView timeline={fold(successFrames.slice(0, 2))} conn="streaming" />,
    )
    const scroll = screen
      .getByLabelText('Event timeline')
      .querySelector('[data-slot="timeline-scroll"]') as HTMLDivElement

    // Simulate a manual scroll-up: not at bottom.
    Object.defineProperty(scroll, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scroll, 'clientHeight', { value: 200, configurable: true })
    Object.defineProperty(scroll, 'scrollTop', { value: 0, configurable: true })
    fireEvent.scroll(scroll)

    // The Jump-to-latest pill appears while paused.
    const pill = screen.getByRole('button', { name: /Jump to latest/ })
    expect(pill).toBeInTheDocument()

    ;(Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear()
    // A new frame arrives while paused → NO follow.
    rerender(
      <TimelineView timeline={fold(successFrames.slice(0, 3))} conn="streaming" />,
    )
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()

    // Jump to latest resumes following.
    fireEvent.click(pill)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('does NOT auto-scroll in replay mode (instant fill — Plan 05)', () => {
    render(
      <TimelineView timeline={fold(successFrames)} conn="closed" mode="replay" />,
    )
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  // ── T-03-V5: all flowd strings rendered as TEXT nodes ──────────────────────

  it('renders a payload containing markup chars as ESCAPED text — never injected (T-03-V5)', () => {
    const xss = '<img src=x onerror=alert(1)>'
    const timeline = fold([
      { kind: 'node_started', payload: { node: xss } },
      { kind: 'flow_err', payload: { error: xss } },
    ])
    const { container } = render(
      <TimelineView timeline={timeline} conn="closed" />,
    )
    // The malicious string is present as text, the img tag is NOT in the DOM.
    expect(screen.getAllByText(xss).length).toBeGreaterThanOrEqual(1)
    expect(container.querySelector('img')).toBeNull()
  })
})
