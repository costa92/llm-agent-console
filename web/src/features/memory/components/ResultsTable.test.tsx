import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { z } from 'zod'

import { OperatorContextProvider } from '@/app/OperatorContextProvider'
import { ResultsTable } from './ResultsTable'
import type { RecallHit } from '@/features/memory/api/schemas'
import { installMemoryFetchMock } from '@/test/mocks/memory-gateway'

const searchSchema = z.object({
  query: z.string().optional(),
  top_k: z.coerce.number().int().min(1).max(50).optional(),
  item: z.string().optional(),
  scoreThreshold: z.coerce.number().optional(),
  pinnedOnly: z.coerce.boolean().optional(),
  disabledFilter: z.enum(['hide', 'only']).optional(),
})

function makeHit(over: Partial<RecallHit>): RecallHit {
  return {
    memory_id: 'mem_x',
    kind: 'semantic',
    score: 0.5,
    version: 1,
    content: 'content',
    pinned: false,
    disabled: false,
    ...over,
  }
}

/** Mount ResultsTable at /memory under a real router so useSearch/useNavigate work. */
function renderTable(hits: RecallHit[], topK: number, initialPath = '/memory') {
  const rootRoute = createRootRoute()
  const memoryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/memory',
    validateSearch: (s) => searchSchema.parse(s),
    component: () => <ResultsTable hits={hits} topK={topK} />,
  })
  const routeTree = rootRoute.addChildren([memoryRoute])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const utils = render(
    <OperatorContextProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </OperatorContextProvider>,
  )
  return { ...utils, router }
}

/** Read the score column values in row order. */
function scoreColumn(container: HTMLElement): string[] {
  const cells = Array.from(
    container.querySelectorAll('tbody tr td:nth-child(2)'),
  )
  return cells.map((c) => c.textContent?.trim() ?? '')
}

describe('ResultsTable (client-side @tanstack/react-table)', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(
      'operator-context',
      JSON.stringify({ tenantId: 'acme', userId: 'u-1', projectId: '', sessionId: '' }),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders hits in score-desc default order', async () => {
    const hits = [
      makeHit({ memory_id: 'a', score: 0.5 }),
      makeHit({ memory_id: 'b', score: 0.9 }),
      makeHit({ memory_id: 'c', score: 0.7 }),
    ]
    const { container } = renderTable(hits, 8)
    await screen.findByRole('table')
    expect(scoreColumn(container)).toEqual(['0.90', '0.70', '0.50'])
  })

  it('toggles sort on header clicks WITHOUT any new recall fetch', async () => {
    const { fetchMock } = installMemoryFetchMock([])
    const hits = [
      makeHit({ memory_id: 'a', score: 0.5 }),
      makeHit({ memory_id: 'b', score: 0.9 }),
      makeHit({ memory_id: 'c', score: 0.7 }),
    ]
    const { container } = renderTable(hits, 8)
    await screen.findByRole('table')

    const callsBefore = fetchMock.mock.calls.length

    // Click the score header → ascending order.
    fireEvent.click(screen.getByRole('button', { name: /score/ }))
    await waitFor(() =>
      expect(scoreColumn(container)).toEqual(['0.50', '0.70', '0.90']),
    )

    // Click memory_id header → sort by id (a,b,c).
    fireEvent.click(screen.getByRole('button', { name: /memory_id/ }))
    await waitFor(() => {
      const ids = Array.from(
        container.querySelectorAll('tbody tr td:nth-child(1)'),
      ).map((c) => c.textContent?.replace(/Copy id/g, '').trim())
      expect(ids).toEqual(['a', 'b', 'c'])
    })

    // No recall fetch happened during sort interactions (client-side proof).
    expect(fetchMock.mock.calls.length).toBe(callsBefore)
  })

  it('renders PINNED / DISABLED badges and dims the disabled row; none for plain hits', async () => {
    const hits = [
      makeHit({ memory_id: 'pin', score: 0.9, pinned: true }),
      makeHit({ memory_id: 'dis', score: 0.8, disabled: true }),
      makeHit({ memory_id: 'plain', score: 0.7 }),
    ]
    const { container } = renderTable(hits, 8)
    await screen.findByRole('table')

    expect(screen.getByText('PINNED')).toBeInTheDocument()
    expect(screen.getByText('DISABLED')).toBeInTheDocument()

    // The disabled row carries the dimmed opacity treatment. Locate it by the
    // exact memory_id text node in its first cell.
    const idCell = within(container.querySelector('tbody')!).getByText('dis')
    expect(idCell.closest('tr')!.className).toContain('opacity-60')

    // exactly one PINNED + one DISABLED badge (plain hit has neither).
    expect(screen.getAllByText('PINNED')).toHaveLength(1)
    expect(screen.getAllByText('DISABLED')).toHaveLength(1)
  })

  it('pinned-only client filter hides non-pinned rows without a new fetch', async () => {
    const { fetchMock } = installMemoryFetchMock([])
    const hits = [
      makeHit({ memory_id: 'pin', score: 0.9, pinned: true }),
      makeHit({ memory_id: 'plain', score: 0.7 }),
    ]
    const { container } = renderTable(hits, 8, '/memory?pinnedOnly=true')
    await screen.findByRole('table')

    const ids = Array.from(
      container.querySelectorAll('tbody tr td:nth-child(1)'),
    ).map((c) => c.textContent?.replace(/Copy id/g, '').trim())
    expect(ids).toEqual(['pin'])
    expect(fetchMock.mock.calls.length).toBe(0)
  })

  it('renders dangerous content as literal text — no img element created (XSS mitigation)', async () => {
    const payload = '<img src=x onerror=alert(1)>'
    const hits = [makeHit({ memory_id: 'x', score: 0.9, content: payload })]
    const { container } = renderTable(hits, 8)
    await screen.findByRole('table')

    expect(screen.getByText(payload)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('row click sets ?item={memory_id} in the router search params', async () => {
    const hits = [makeHit({ memory_id: 'mem_click', score: 0.9 })]
    const { container, router } = renderTable(hits, 8)
    await screen.findByRole('table')

    const row = container.querySelector('tbody tr')!
    fireEvent.click(row)

    await waitFor(() => {
      const search = router.state.location.search as { item?: string }
      expect(search.item).toBe('mem_click')
    })
  })

  it('renders memory_id via the Phase-1 CopyableId (mono id + copy affordance)', async () => {
    const hits = [makeHit({ memory_id: 'mem_copy', score: 0.9 })]
    const { container } = renderTable(hits, 8)
    await screen.findByRole('table')

    expect(screen.getByText('mem_copy')).toBeInTheDocument()
    expect(
      within(container.querySelector('tbody')!).getByLabelText('Copy id'),
    ).toBeInTheDocument()
  })

  it('shows the IC-1 increase-top-k hint when results.length === topK (at cap)', async () => {
    const hits = Array.from({ length: 5 }, (_, i) =>
      makeHit({ memory_id: `m${i}`, score: 1 - i * 0.1 }),
    )
    renderTable(hits, 5)
    await screen.findByRole('table')

    expect(
      screen.getByText('Showing top 5. Increase top-k to pull more (max 50).'),
    ).toBeInTheDocument()
  })

  it('hides the IC-1 hint when results.length < topK (below cap)', async () => {
    const hits = Array.from({ length: 3 }, (_, i) =>
      makeHit({ memory_id: `m${i}`, score: 1 - i * 0.1 }),
    )
    renderTable(hits, 8)
    await screen.findByRole('table')

    expect(screen.queryByText(/Increase top-k to pull more/)).not.toBeInTheDocument()
  })
})
