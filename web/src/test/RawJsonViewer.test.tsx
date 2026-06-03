import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Mock the app-wide sonner toast (the "Copied" confirmation).
const toastSuccess = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (...args: unknown[]) => toastSuccess(...args) },
}))

import { RawJsonViewer } from '@/components/primitives/RawJsonViewer'

const writeText = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  toastSuccess.mockClear()
  writeText.mockClear()
  vi.stubGlobal('navigator', { clipboard: { writeText } })
})

const data = { tenant: 'acme', count: 3 }
const pretty = JSON.stringify(data, null, 2)

describe('RawJsonViewer', () => {
  it('is collapsed by default — JSON body is not in the DOM', () => {
    render(<RawJsonViewer data={data} />)
    expect(screen.queryByText(/"tenant": "acme"/)).not.toBeInTheDocument()
  })

  it('expands on toggle — JSON body becomes visible', () => {
    render(<RawJsonViewer data={data} />)
    fireEvent.click(screen.getByRole('button', { name: /raw json/i }))
    expect(screen.getByText(/"tenant": "acme"/)).toBeInTheDocument()
  })

  it('copy button writes the stringified JSON to the clipboard', () => {
    render(<RawJsonViewer data={data} />)
    fireEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(writeText).toHaveBeenCalledWith(pretty)
  })

  it('shows a "Copied" toast after copy', () => {
    render(<RawJsonViewer data={data} />)
    fireEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(toastSuccess).toHaveBeenCalledWith('Copied')
  })
})
