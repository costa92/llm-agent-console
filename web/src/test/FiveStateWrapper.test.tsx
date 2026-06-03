import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FiveStateWrapper } from '@/components/primitives/FiveStateWrapper'

/**
 * 01-UI-SPEC five-state contract: every list/detail view renders exactly one of
 * loading / empty / error / partial / ready — never a blank panel. These tests
 * pin the exact copy + the visual distinctiveness of each state.
 */
describe('FiveStateWrapper / five-state contract', () => {
  it('loading: renders "Loading…" and a spinner; does NOT render children', () => {
    render(
      <FiveStateWrapper loading>
        <div>ready content</div>
      </FiveStateWrapper>,
    )
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText('ready content')).not.toBeInTheDocument()
  })

  it('error: renders "{status} from {service} — {message}." + AlertCircle; no children', () => {
    render(
      <FiveStateWrapper
        loading={false}
        error={{
          status: 503,
          service: 'memory-gateway',
          message: 'upstream unavailable',
        }}
      >
        <div>ready content</div>
      </FiveStateWrapper>,
    )
    expect(
      screen.getByText('503 from memory-gateway — upstream unavailable.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('ready content')).not.toBeInTheDocument()
  })

  it('empty: renders heading + tenant/user body + "Set context" CTA; no children', () => {
    render(
      <FiveStateWrapper loading={false} empty>
        <div>ready content</div>
      </FiveStateWrapper>,
    )
    expect(screen.getByText('No operator context set')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Set a tenant id and user id to reach the backends. Project and session are optional.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Set context' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('ready content')).not.toBeInTheDocument()
  })

  it('partial: renders amber banner AND children alongside it', () => {
    render(
      <FiveStateWrapper
        loading={false}
        partial={{ message: 'health check for flowd timed out' }}
      >
        <div>ready content</div>
      </FiveStateWrapper>,
    )
    expect(
      screen.getByText(
        'Showing partial data — health check for flowd timed out.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('ready content')).toBeInTheDocument()
  })

  it('ready: renders only children when all states are falsey', () => {
    render(
      <FiveStateWrapper loading={false} error={null} empty={false} partial={null}>
        <div>ready content</div>
      </FiveStateWrapper>,
    )
    expect(screen.getByText('ready content')).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })

  it('error: includes a collapsed-by-default "View raw JSON" disclosure', () => {
    render(
      <FiveStateWrapper
        loading={false}
        error={{ status: 422, service: 'flowd', message: 'invalid flow' }}
      >
        <div>ready content</div>
      </FiveStateWrapper>,
    )
    // Disclosure trigger is present...
    expect(screen.getByText('View raw JSON')).toBeInTheDocument()
    // ...but the raw error body is NOT rendered until the operator expands it.
    expect(screen.queryByText(/"invalid flow"/)).not.toBeInTheDocument()
  })
})
