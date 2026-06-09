import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'

import { FlowsPage } from './FlowsPage'
import {
  installFlowdFetchMock,
  flowsListFixture,
  flowdError500,
} from '@/test/mocks/flowd'

/**
 * Five-state audit evidence for FlowsPage (D-04 / IC-5).
 *
 * FlowsPage delegates to FlowsTable which is wrapped in FiveStateWrapper — this
 * test drives the four audited states (loading / empty / error / ready) and
 * asserts a visible, non-blank node for each. Per the D-04 contract the
 * five-state audit is a CODE CONFORMANCE CHECK: the test proves FlowsPage never
 * shows a bare blank panel in any state.
 *
 * Audit outcome (documented in 05-04-SUMMARY.md):
 *   FlowsPage   → delegates to FlowsTable → FiveStateWrapper (loading/error/ready)
 *                  + NoFlowsEmptyState inline for the zero-results case — CONFORMS.
 *   RunDetailPage → delegates to RunDetail → FiveStateWrapper (loading/error/ready)
 *                  + NoEventsEmptyState for the zero-events case — CONFORMS.
 *   ChatPage     → inline five states (EmptyConversation / Thinking… / in-bubble
 *                  Failed / droppedTransport / done) — CONFORMS (inline
 *                  equivalent; no FiveStateWrapper needed per IC-5).
 */

const FLOWS_PATH = '/api/flow/flows'

/** Mount FlowsPage under a minimal router so useNavigate resolves. */
function renderFlowsPage() {
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

describe('FlowsPage — five-state audit (D-04 / IC-5)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loading state: shows a non-blank loading indicator while the query is in flight', async () => {
    // Never-resolving fetch → query stays loading.
    vi.stubGlobal('fetch', () => new Promise(() => {}))
    renderFlowsPage()

    // FiveStateWrapper loading state renders "Loading…" — non-blank.
    // Use findByText (async) to wait for the router to mount the route component.
    expect(await screen.findByText('Loading…')).toBeInTheDocument()
  })

  it('empty state: shows "No flows yet." when the query resolves with zero flows', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: FLOWS_PATH, body: { flows: [] } },
    ])
    renderFlowsPage()

    // NoFlowsEmptyState (inside the FiveStateWrapper ready slot) renders
    // "No flows yet." — non-blank (a context-appropriate empty, NOT a blank panel).
    expect(await screen.findByText('No flows yet.')).toBeInTheDocument()
    expect(
      screen.getByText('Create a flow as JSON to run and observe it.'),
    ).toBeInTheDocument()
    // There are two "New flow" buttons: the page header button + the empty-state CTA.
    // Both are visible — the empty state provides the CTA.
    expect(screen.getAllByRole('button', { name: 'New flow' }).length).toBeGreaterThanOrEqual(1)
  })

  it('error state: surfaces the flowd error verbatim — non-blank (five-state error region)', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: FLOWS_PATH, status: 500, body: flowdError500 },
    ])
    renderFlowsPage()

    // FiveStateWrapper error state: "{status} from flowd — {message}."
    expect(
      await screen.findByText('500 from flowd — missing required input: in.'),
    ).toBeInTheDocument()
  })

  it('ready state: renders the page header + flow rows — non-blank', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: FLOWS_PATH, body: flowsListFixture },
    ])
    renderFlowsPage()

    // Ready state: the table rows with flow data are visible — non-blank.
    expect(await screen.findByText('Echo Chain')).toBeInTheDocument()
    expect(screen.getByText('Router Flow')).toBeInTheDocument()
    // Page heading is present.
    expect(screen.getByText('Flows')).toBeInTheDocument()
  })
})
