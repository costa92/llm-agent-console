import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'

import { FlowsTable } from './FlowsTable'
import { FlowsPage } from '../FlowsPage'
import {
  installFlowdFetchMock,
  flowsListFixture,
  flowdError500,
} from '@/test/mocks/flowd'

const FLOWS_PATH = '/api/flow/flows'

/**
 * Mount FlowsTable (via FlowsPage at /flows) under a real router so useNavigate
 * resolves the typed flow routes (/flows, /flows/new, /flows/$flowId). The
 * detail/new routes render a sentinel so a row-click / New-flow nav is
 * observable without pulling in Task-2 components.
 */
function renderFlows(initialPath = '/flows') {
  const rootRoute = createRootRoute()
  const flowsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/flows',
    component: FlowsPage,
  })
  const flowNewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/flows/new',
    component: () => <div>NEW FLOW ROUTE</div>,
  })
  const flowDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/flows/$flowId',
    component: () => <div>DETAIL ROUTE</div>,
  })
  const routeTree = rootRoute.addChildren([
    flowsRoute,
    flowNewRoute,
    flowDetailRoute,
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...utils, router }
}

/** Mount FlowsTable alone (for the empty/error states — no nav needed). */
function renderTableOnly() {
  const rootRoute = createRootRoute()
  const flowsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/flows',
    component: () => <FlowsTable />,
  })
  const flowNewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/flows/new',
    component: () => <div>NEW FLOW ROUTE</div>,
  })
  const flowDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/flows/$flowId',
    component: () => <div>DETAIL ROUTE</div>,
  })
  const routeTree = rootRoute.addChildren([
    flowsRoute,
    flowNewRoute,
    flowDetailRoute,
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/flows'] }),
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('FlowsTable (S1 / FLOW-01)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the flows from GET /flows with copyable ids + timestamps', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: FLOWS_PATH, body: flowsListFixture },
    ])
    renderFlows()

    await screen.findByRole('table')
    // Both fixture flows render their ids (mono CopyableId).
    expect(screen.getByText('echo_chain')).toBeInTheDocument()
    expect(screen.getByText('router_flow')).toBeInTheDocument()
    // Names render (sans).
    expect(screen.getByText('Echo Chain')).toBeInTheDocument()
    // Timestamps render (mono).
    expect(screen.getByText('2026-06-03T10:00:00Z')).toBeInTheDocument()
    // CopyableId affordance present on a row.
    expect(screen.getAllByLabelText('Copy id').length).toBeGreaterThanOrEqual(2)
  })

  it('shows the "No flows yet." empty state with a New flow CTA when the list is empty', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: FLOWS_PATH, body: { flows: [] } },
    ])
    renderTableOnly()

    expect(await screen.findByText('No flows yet.')).toBeInTheDocument()
    expect(
      screen.getByText('Create a flow as JSON to run and observe it.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New flow' })).toBeInTheDocument()
  })

  it('surfaces a flowd error verbatim in the five-state error region', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: FLOWS_PATH, status: 500, body: flowdError500 },
    ])
    renderTableOnly()

    // "{status} from flowd — {error}." per UI-SPEC.
    expect(
      await screen.findByText('500 from flowd — missing required input: in.'),
    ).toBeInTheDocument()
  })

  it('navigates to /flows/{id} on a row click', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: FLOWS_PATH, body: flowsListFixture },
    ])
    const { container, router } = renderFlows()
    await screen.findByRole('table')

    // Click the first data row (NOT the CopyableId button — that stops
    // propagation; click a timestamp cell instead).
    const firstRow = within(container.querySelector('tbody')!).getAllByRole(
      'row',
    )[0]
    fireEvent.click(firstRow)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/flows/echo_chain')
    })
  })

  it('routes to /flows/new from the page "New flow" button', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: FLOWS_PATH, body: flowsListFixture },
    ])
    const { router } = renderFlows()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: 'New flow' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/flows/new')
    })
  })

  it('renders flowd id/name strings as literal text — no markup injected (T-03-V5)', async () => {
    const xss = '<img src=x onerror=alert(1)>'
    installFlowdFetchMock([
      {
        method: 'GET',
        path: FLOWS_PATH,
        body: {
          flows: [
            {
              id: 'evil',
              name: xss,
              created_at: '2026-06-03T10:00:00Z',
              updated_at: '2026-06-03T10:05:00Z',
            },
          ],
        },
      },
    ])
    const { container } = renderFlows()
    await screen.findByRole('table')

    expect(screen.getByText(xss)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })
})
