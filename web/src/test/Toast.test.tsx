import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { toast, Toaster } from 'sonner'

/**
 * SHELL-06 toast contract:
 * - success toasts auto-dismiss and carry NO "Copy error" affordance
 * - error toasts render "{action} failed — {status}: {message}" + a "Copy error"
 *   action button
 */
async function flush() {
  // Let sonner mount the toast into the DOM.
  await act(async () => {
    await Promise.resolve()
  })
}

describe('Toast / SHELL-06', () => {
  it('success toast renders without a Copy error affordance', async () => {
    render(<Toaster />)
    act(() => {
      toast.success('Context saved.')
    })
    await flush()
    expect(await screen.findByText('Context saved.')).toBeInTheDocument()
    expect(screen.queryByText('Copy error')).not.toBeInTheDocument()
  })

  it('error toast renders status+message and a Copy error button', async () => {
    render(<Toaster />)
    act(() => {
      toast.error('Save failed — 422: unprocessable entity', {
        action: { label: 'Copy error', onClick: vi.fn() },
      })
    })
    await flush()
    expect(
      await screen.findByText('Save failed — 422: unprocessable entity'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Copy error' }),
    ).toBeInTheDocument()
  })
})
