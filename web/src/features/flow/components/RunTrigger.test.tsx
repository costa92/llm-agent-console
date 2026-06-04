import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'

import {
  installFlowdFetchMock,
  runSyncResponse,
  flowdError500,
} from '@/test/mocks/flowd'

// ── Mock the Plan-03 stream hook so we control X-Run-ID timing + assert start() ──
const startSpy = vi.fn()
const retrySpy = vi.fn()
const replaySpy = vi.fn()
vi.mock('@/features/flow/timeline/useRunStream', () => ({
  useRunStream: () => ({
    timeline: {
      events: [],
      seen: new Set(),
      ordinals: { live: {}, history: {} },
      nodeStatus: {},
      terminal: 'none',
    },
    conn: 'idle',
    runId: undefined,
    start: startSpy,
    replay: replaySpy,
    retry: retrySpy,
  }),
}))

import { RunTrigger } from './RunTrigger'

const FLOW_ID = 'echo_chain'
const RUN_PATH = `/api/flow/flows/${FLOW_ID}/run`

/**
 * Mount RunTrigger under a real router so `useNavigate` resolves. The run
 * sub-route renders a sentinel so the X-Run-ID navigation is observable.
 */
function renderTrigger() {
  const rootRoute = createRootRoute()
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/flows/$flowId',
    component: () => <RunTrigger flowId={FLOW_ID} />,
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
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...utils, router }
}

describe('RunTrigger (S4 / D-04 / D-08)', () => {
  beforeEach(() => {
    startSpy.mockReset()
    retrySpy.mockReset()
    replaySpy.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('primary "Run" starts the stream and navigates to /flows/{id}/runs/{runId} on X-Run-ID (D-08)', async () => {
    const { router } = renderTrigger()

    fireEvent.click(await screen.findByRole('button', { name: 'Run' }))

    // start() called with (flowId, inputs, { onRunId }).
    expect(startSpy).toHaveBeenCalledTimes(1)
    const [calledFlowId, calledInputs, opts] = startSpy.mock.calls[0]
    expect(calledFlowId).toBe(FLOW_ID)
    expect(calledInputs).toEqual({})
    expect(typeof opts.onRunId).toBe('function')

    // Simulate flowd's X-Run-ID arriving → it must navigate to the run sub-route.
    opts.onRunId('run_live_42')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        '/flows/echo_chain/runs/run_live_42',
      )
    })
  })

  it('sends inputs as a string→string map', async () => {
    renderTrigger()
    fireEvent.change(await screen.findByLabelText('Input key 1'), {
      target: { value: 'in' },
    })
    fireEvent.change(screen.getByLabelText('Input value 1'), {
      target: { value: 'hello' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(startSpy.mock.calls[0][1]).toEqual({ in: 'hello' })
  })

  it('secondary "Run (sync)" renders {outputs} into the RunResultPanel (ONE result surface, D-04)', async () => {
    installFlowdFetchMock([
      { method: 'POST', path: RUN_PATH, body: runSyncResponse },
    ])
    renderTrigger()

    fireEvent.click(await screen.findByRole('button', { name: 'Run (sync)' }))

    // The outputs land in the result panel (collapsed raw-JSON viewer → expand).
    const panel = await screen.findByLabelText('Run result')
    const outputs = await waitFor(() =>
      panel.querySelector('[data-slot="run-outputs"]'),
    )
    expect(outputs).not.toBeNull()
    // Streamed run is NOT started by the sync path.
    expect(startSpy).not.toHaveBeenCalled()
  })

  it('a failed sync run renders the {error} in the result panel (red)', async () => {
    installFlowdFetchMock([
      { method: 'POST', path: RUN_PATH, status: 500, body: flowdError500 },
    ])
    renderTrigger()

    fireEvent.click(await screen.findByRole('button', { name: 'Run (sync)' }))

    // The verbatim flowd message renders in the panel as the red error.
    expect(
      await screen.findByText('missing required input: in'),
    ).toBeInTheDocument()
  })
})
