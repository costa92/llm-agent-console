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
import { MemoryPage } from './MemoryPage'
import {
  installMemoryFetchMock,
  recallNonEmpty,
} from '@/test/mocks/memory-gateway'

const RECALL_PATH = '/api/memory/recall/unified'

/**
 * Mount MemoryPage at /memory under a real TanStack Router (NOT MemoryRouter),
 * matching the Phase-1 test pattern. The root route hosts the same search
 * schema the production memory route uses so useSearch/useNavigate work.
 */
const searchSchema = z.object({
  query: z.string().optional(),
  top_k: z.coerce.number().int().min(1).max(50).optional(),
  item: z.string().optional(),
  scoreThreshold: z.coerce.number().optional(),
  pinnedOnly: z.coerce.boolean().optional(),
  disabledFilter: z.enum(['hide', 'only']).optional(),
})

function makeRouter(initialPath = '/memory') {
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

function renderPage(opts: {
  tenantId?: string
  userId?: string
  path?: string
}) {
  localStorage.setItem(
    'operator-context',
    JSON.stringify({
      tenantId: opts.tenantId ?? '',
      userId: opts.userId ?? '',
      projectId: '',
      sessionId: '',
    }),
  )
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
  return { ...utils, router }
}

describe('MemoryPage — D-12 context gate (MEM-08 / IC-7)', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('gates the whole route and fires ZERO recall when tenant is unset', async () => {
    const { fetchMock } = installMemoryFetchMock([
      { method: 'POST', path: RECALL_PATH, body: recallNonEmpty },
    ])
    renderPage({ tenantId: '', userId: 'u-1' })

    expect(
      await screen.findByText('No operator context set'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set context' })).toBeInTheDocument()
    // No SearchControls and no recall request.
    expect(screen.queryByPlaceholderText('Search memory…')).not.toBeInTheDocument()
    const recallCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/recall/unified'),
    )
    expect(recallCalls).toHaveLength(0)
  })

  it('gates the route when user is unset (both required) — zero recall', async () => {
    const { fetchMock } = installMemoryFetchMock([
      { method: 'POST', path: RECALL_PATH, body: recallNonEmpty },
    ])
    renderPage({ tenantId: 'acme', userId: '' })

    expect(
      await screen.findByText('No operator context set'),
    ).toBeInTheDocument()
    const recallCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/recall/unified'),
    )
    expect(recallCalls).toHaveLength(0)
  })
})

describe('MemoryPage — search surface (gate cleared)', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders SearchControls (query + Recall) once both tenant and user are set', async () => {
    installMemoryFetchMock([
      { method: 'POST', path: RECALL_PATH, body: recallNonEmpty },
    ])
    renderPage({ tenantId: 'acme', userId: 'u-1' })

    expect(
      await screen.findByPlaceholderText('Search memory…'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Recall/ })).toBeInTheDocument()
    expect(screen.queryByText('No operator context set')).not.toBeInTheDocument()
  })

  it('fires NO recall while the query is empty (no doomed empty-query POST)', async () => {
    const { fetchMock } = installMemoryFetchMock([
      { method: 'POST', path: RECALL_PATH, body: recallNonEmpty },
    ])
    renderPage({ tenantId: 'acme', userId: 'u-1' })

    await screen.findByPlaceholderText('Search memory…')
    // Give any enabled query a tick to (not) fire.
    await new Promise((r) => setTimeout(r, 0))
    const recallCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/recall/unified'),
    )
    expect(recallCalls).toHaveLength(0)
  })

  it('writes query + top_k into the URL search params on Recall submit', async () => {
    installMemoryFetchMock([
      { method: 'POST', path: RECALL_PATH, body: recallNonEmpty },
    ])
    const { router } = renderPage({ tenantId: 'acme', userId: 'u-1' })

    const queryInput = await screen.findByPlaceholderText('Search memory…')
    fireEvent.change(queryInput, { target: { value: 'foo' } })
    const topK = screen.getByLabelText('top_k')
    fireEvent.change(topK, { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: /Recall/ }))

    await waitFor(() => {
      const search = router.state.location.search as {
        query?: string
        top_k?: number
      }
      expect(search.query).toBe('foo')
      expect(search.top_k).toBe(12)
    })
  })

  it('keeps the Advanced filter controls hidden until the toggle is activated', async () => {
    installMemoryFetchMock([
      { method: 'POST', path: RECALL_PATH, body: recallNonEmpty },
    ])
    renderPage({ tenantId: 'acme', userId: 'u-1' })

    await screen.findByPlaceholderText('Search memory…')
    expect(screen.queryByLabelText('Score threshold')).not.toBeInTheDocument()
    expect(screen.queryByText('Pinned only')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))

    expect(await screen.findByLabelText('Score threshold')).toBeInTheDocument()
    expect(screen.getByText('Pinned only')).toBeInTheDocument()
  })

  it('renders the distinct zero-hits empty state for a valid empty recall', async () => {
    installMemoryFetchMock([
      { method: 'POST', path: RECALL_PATH, body: { hits: [] } },
    ])
    renderPage({
      tenantId: 'acme',
      userId: 'u-1',
      path: '/memory?query=nothing&top_k=8',
    })

    expect(await screen.findByText('No memory matched.')).toBeInTheDocument()
    // distinct from the context gate
    expect(screen.queryByText('No operator context set')).not.toBeInTheDocument()
  })

  it('renders ranked results in a table once a query is submitted via URL', async () => {
    installMemoryFetchMock([
      { method: 'POST', path: RECALL_PATH, body: recallNonEmpty },
    ])
    renderPage({
      tenantId: 'acme',
      userId: 'u-1',
      path: '/memory?query=prefs&top_k=8',
    })

    const table = await screen.findByRole('table')
    expect(within(table).getByText('User prefers concise technical answers.')).toBeInTheDocument()
  })
})
