import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'

import { RunsHistory } from './RunsHistory'
import {
  installFlowdFetchMock,
  runsListFixture,
  flowdError500,
} from '@/test/mocks/flowd'

const FLOW_ID = 'echo_chain'
const RUNS_PATH = `/api/flow/flows/${FLOW_ID}/runs`

/**
 * Mount RunsHistory under a real router so `useNavigate` resolves the run
 * sub-route param path. The run sub-route renders a sentinel so a row-click
 * navigation is observable without pulling in Task-2 components.
 */
function renderHistory() {
  const rootRoute = createRootRoute()
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/flows/$flowId',
    component: () => <RunsHistory flowId={FLOW_ID} />,
  })
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/flows/$flowId/runs/$runId',
    component: () => <div>RUN SUBROUTE</div>,
  })
  const routeTree = rootRoute.addChildren([detailRoute, runRoute])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/flows/${FLOW_ID}`] }),
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

describe('RunsHistory (S7 / FLOW-05 / D-07)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders runs from GET /flows/{id}/runs with status badges + timestamps + copyable ids', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: RUNS_PATH, body: runsListFixture },
    ])
    renderHistory()

    await screen.findByRole('table')

    // Both fixture run ids render (mono CopyableId).
    expect(screen.getByText('run_abc')).toBeInTheDocument()
    expect(screen.getByText('run_def')).toBeInTheDocument()

    // Status badges render their labels (Color (d)): a done + a running run.
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()

    // A finished_at timestamp renders for the terminal run...
    expect(screen.getByText('2026-06-03T10:00:02Z')).toBeInTheDocument()
    // ...and the still-running run renders "—" for its absent finished_at.
    expect(screen.getByText('—')).toBeInTheDocument()

    // CopyableId affordance present per row.
    expect(screen.getAllByLabelText('Copy id').length).toBeGreaterThanOrEqual(2)
  })

  it('shows the "No runs yet." empty state when the flow has no runs', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: RUNS_PATH, body: { runs: [] } },
    ])
    renderHistory()

    expect(await screen.findByText('No runs yet.')).toBeInTheDocument()
    expect(
      screen.getByText('Run this flow to see its execution history here.'),
    ).toBeInTheDocument()
  })

  it('surfaces a flowd error verbatim in the five-state error region', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: RUNS_PATH, status: 500, body: flowdError500 },
    ])
    renderHistory()

    expect(
      await screen.findByText('500 from flowd — missing required input: in.'),
    ).toBeInTheDocument()
  })

  it('navigates to the run sub-route /flows/{id}/runs/{runId} on a row click', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: RUNS_PATH, body: runsListFixture },
    ])
    const { container, router } = renderHistory()
    await screen.findByRole('table')

    // Click the first data row. The default sort is started_at desc, so the
    // first row is the later-started run (run_def, 10:10) — assert against
    // whichever id the clicked row carries rather than hard-coding order.
    const firstRow = within(container.querySelector('tbody')!).getAllByRole(
      'row',
    )[0]
    const runId = within(firstRow).getByText(/^run_/).textContent!
    fireEvent.click(firstRow)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/flows/${FLOW_ID}/runs/${runId}`,
      )
    })
  })

  it('renders flowd run id/timestamp strings as literal text — no markup injected (T-03-V5)', async () => {
    const xss = '<img src=x onerror=alert(1)>'
    installFlowdFetchMock([
      {
        method: 'GET',
        path: RUNS_PATH,
        body: {
          runs: [
            {
              id: xss,
              flow_id: FLOW_ID,
              status: 'done',
              started_at: '2026-06-03T10:00:00Z',
              finished_at: '2026-06-03T10:00:02Z',
            },
          ],
        },
      },
    ])
    const { container } = renderHistory()
    await screen.findByRole('table')

    expect(screen.getByText(xss)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })
})
