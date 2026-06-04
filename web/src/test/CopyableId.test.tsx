import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const toastSuccess = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (...args: unknown[]) => toastSuccess(...args) },
}))

import { CopyableId } from '@/components/primitives/CopyableId'

const writeText = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  toastSuccess.mockClear()
  writeText.mockClear()
  vi.stubGlobal('navigator', { clipboard: { writeText } })
})

describe('CopyableId', () => {
  it('renders the id value in a monospace element', () => {
    const { container } = render(<CopyableId id="run_abc123" />)
    const mono = container.querySelector('.mono')
    expect(mono).not.toBeNull()
    expect(mono).toHaveTextContent('run_abc123')
  })

  it('clicking the copy icon writes the id to the clipboard', () => {
    render(<CopyableId id="run_abc123" />)
    fireEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(writeText).toHaveBeenCalledWith('run_abc123')
  })

  it('after copy: shows a "Copied" toast and swaps the icon to Check', async () => {
    render(<CopyableId id="run_abc123" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /copy/i }))
      await Promise.resolve()
    })
    expect(toastSuccess).toHaveBeenCalledWith('Copied')
    // The lucide Check icon carries a stable class for assertion.
    expect(document.querySelector('.lucide-check')).not.toBeNull()
  })
})
