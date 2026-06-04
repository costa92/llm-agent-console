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
import { MemoryPage } from '../MemoryPage'
import {
  installMemoryFetchMock,
  itemFixture,
  recallNonEmpty,
} from '@/test/mocks/memory-gateway'

const RECALL_PATH = '/api/memory/recall/unified'
const ITEM_PATH = '/api/memory/items/mem_123'

/** A 404 not_found envelope (golden gateway error shape). */
const notFound404 = {
  error: {
    code: 'not_found',
    message: 'memory item not found',
    request_id: 'req_404',
    retryable: false,
    details: {},
  },
}

/**
 * Mount MemoryPage (which hosts <ItemDrawer/>) at /memory under a real TanStack
 * Router, matching the Phase-1/Slice-A test pattern. The root route hosts the
 * same search schema the production memory route uses so useSearch/useNavigate —
 * and the ?item param the drawer reads — work end-to-end.
 */
const searchSchema = z.object({
  query: z.string().optional(),
  top_k: z.coerce.number().int().min(1).max(50).optional(),
  item: z.string().optional(),
  scoreThreshold: z.coerce.number().optional(),
  pinnedOnly: z.coerce.boolean().optional(),
  disabledFilter: z.enum(['hide', 'only']).optional(),
})

function makeRouter(initialPath: string) {
  const rootRoute = createRootRoute()
  const memoryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/memory',
    validateSearch: (s) => searchSchema.parse(s),
    component: MemoryPage,
  })
  const routeTree = rootRoute.addChildren([memoryRoute])
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
}

function renderPage(opts: { path: string; itemRoute?: { status?: number; body: unknown } }) {
  localStorage.setItem(
    'operator-context',
    JSON.stringify({
      tenantId: 'acme',
      userId: 'u-1',
      projectId: '',
      sessionId: '',
    }),
  )
  const itemRoute = opts.itemRoute ?? { body: itemFixture }
  const { fetchMock } = installMemoryFetchMock([
    { method: 'POST', path: RECALL_PATH, body: recallNonEmpty },
    {
      method: 'GET',
      path: ITEM_PATH,
      status: itemRoute.status,
      body: itemRoute.body,
    },
  ])
  const router = makeRouter(opts.path)
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
  return { ...utils, router, fetchMock }
}

function itemCalls(fetchMock: ReturnType<typeof installMemoryFetchMock>['fetchMock']) {
  return fetchMock.mock.calls.filter((c) => String(c[0]).includes('/items/mem_123'))
}
function recallCalls(fetchMock: ReturnType<typeof installMemoryFetchMock>['fetchMock']) {
  return fetchMock.mock.calls.filter((c) => String(c[0]).includes('/recall/unified'))
}

describe('ItemDrawer — ?item-synced item detail drawer (MEM-02 / D-04/D-05 / IC-2)', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('opens the drawer and fires GET item when ?item={id} is set', async () => {
    const { fetchMock } = renderPage({ path: '/memory?item=mem_123' })

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await waitFor(() => expect(itemCalls(fetchMock).length).toBeGreaterThanOrEqual(1))
  })

  it('renders the item fields (memory_id via CopyableId, kind, version, content, tags)', async () => {
    renderPage({ path: '/memory?item=mem_123' })

    const dialog = await screen.findByRole('dialog')
    // memory_id rendered (CopyableId mono span) + its Copy id control present.
    expect(await within(dialog).findByText('mem_123')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Copy id' })).toBeInTheDocument()
    // kind, content, tags rendered.
    expect(within(dialog).getByText('semantic')).toBeInTheDocument()
    expect(
      within(dialog).getByText('User prefers concise technical answers.'),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('preference')).toBeInTheDocument()
    expect(within(dialog).getByText('style')).toBeInTheDocument()
    // version value (7) rendered somewhere in the field grid.
    expect(within(dialog).getByText('7')).toBeInTheDocument()
  })

  it('includes the Phase-1 RawJsonViewer, collapsed by default (raw JSON not in DOM until expanded)', async () => {
    renderPage({ path: '/memory?item=mem_123' })

    const dialog = await screen.findByRole('dialog')
    const disclosure = await within(dialog).findByRole('button', { name: /Raw JSON/ })
    expect(disclosure).toBeInTheDocument()
    // Collapsed: the pretty-printed JSON (with the "memory_id": key) is NOT yet rendered.
    expect(within(dialog).queryByText(/"memory_id": "mem_123"/)).not.toBeInTheDocument()

    fireEvent.click(disclosure)
    expect(
      await within(dialog).findByText((t) => t.includes('"memory_id": "mem_123"')),
    ).toBeInTheDocument()
  })

  it('shows the loading state (not a blank panel) while the GET item is in flight', async () => {
    // Never-resolving GET so the drawer stays in the loading state.
    const pending = new Promise<Response>(() => {})
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/items/mem_123')) return pending
      return new Response(JSON.stringify(recallNonEmpty), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    localStorage.setItem(
      'operator-context',
      JSON.stringify({ tenantId: 'acme', userId: 'u-1', projectId: '', sessionId: '' }),
    )
    const router = makeRouter('/memory?item=mem_123')
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <OperatorContextProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </OperatorContextProvider>,
    )

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Loading…')).toBeInTheDocument()
  })

  it('renders the ERROR state (not empty) inside the drawer on a 404 not_found', async () => {
    renderPage({
      path: '/memory?item=mem_123',
      itemRoute: { status: 404, body: notFound404 },
    })

    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByText(/404 from memory-gateway — memory item not found/),
    ).toBeInTheDocument()
    // Error, not the unset-context/empty state.
    expect(within(dialog).queryByText('No operator context set')).not.toBeInTheDocument()
  })

  it('closing the drawer clears ?item without re-running recall', async () => {
    const { router, fetchMock } = renderPage({
      path: '/memory?query=prefs&top_k=8&item=mem_123',
    })

    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('mem_123')
    const recallBefore = recallCalls(fetchMock).length

    fireEvent.click(within(dialog).getByRole('button', { name: /Close/ }))

    await waitFor(() => {
      const search = router.state.location.search as { item?: string }
      expect(search.item).toBeUndefined()
    })
    // No recall re-fired by closing the drawer (D-09 — recall is operator-initiated).
    expect(recallCalls(fetchMock).length).toBe(recallBefore)
  })

  it('does not mount the drawer and fires no GET item when ?item is absent', async () => {
    const { fetchMock } = renderPage({ path: '/memory?query=prefs&top_k=8' })

    // The results table renders, but no drawer dialog.
    await screen.findByRole('table')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 0))
    expect(itemCalls(fetchMock)).toHaveLength(0)
  })
})
