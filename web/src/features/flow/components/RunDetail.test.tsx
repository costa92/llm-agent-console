import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'

import {
  makeFakeSseStream,
  goldenSuccess,
  type FakeSseStream,
} from '@/test/mocks/fetch-event-source'
import {
  installFlowdFetchMock,
  runMetaFixture,
  runEventsFixture,
  runEventsEmpty,
} from '@/test/mocks/flowd'

// ── Mock the SSE wrapper so the REAL useRunStream hook drives the REAL reducer
//    off scripted frames (proving the SAME reducer/renderer for live + replay). ──
let fake: FakeSseStream
vi.mock('@/lib/sse', () => ({
  // Forward to the current fake (re-created per test in beforeEach).
  openSseStream: (opts: unknown) =>
    (fake.openSseStream as unknown as (o: unknown) => Promise<void>)(opts),
}))

// HTMLElement.scrollIntoView is unimplemented in jsdom — the live TimelineView
// calls it for auto-scroll; stub so the mount does not throw.
beforeEach(() => {
  fake = makeFakeSseStream()
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// Imported AFTER the mock so the hook resolves the mocked wrapper.
const { RunDetail } = await import('./RunDetail')

const RUN_ID = 'run_abc'
const RUN_PATH = `/api/flow/runs/${RUN_ID}`
const EVENTS_PATH = `/api/flow/runs/${RUN_ID}/events`

/** Mount RunDetail under a real router (CopyableId/links need it). */
function renderDetail() {
  const rootRoute = createRootRoute()
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/flows/$flowId',
    component: () => <div>FLOW DETAIL</div>,
  })
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/flows/$flowId/runs/$runId',
    component: () => <RunDetail flowId="echo_chain" runId={RUN_ID} />,
  })
  const routeTree = rootRoute.addChildren([detailRoute, runRoute])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [`/flows/echo_chain/runs/${RUN_ID}`],
    }),
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

describe('RunDetail (S8 / D-07 / D-08 / IC-7) — the single live+replay location', () => {
  it('renders the run summary: status badge + timestamps + inputs/outputs', async () => {
    installFlowdFetchMock([
      {
        method: 'GET',
        path: RUN_PATH,
        body: { ...runMetaFixture, inputs: { in: 'hello' }, outputs: { out: 'OLLEH' } },
      },
      { method: 'GET', path: EVENTS_PATH, body: runEventsFixture },
    ])
    renderDetail()

    // Status badge (done) + timestamps render.
    expect(await screen.findByText('Done')).toBeInTheDocument()
    expect(screen.getByText('2026-06-03T10:00:00Z')).toBeInTheDocument()
    expect(screen.getByText('2026-06-03T10:00:02Z')).toBeInTheDocument()
    // The run id is copyable in the summary header.
    expect(screen.getByText(RUN_ID)).toBeInTheDocument()

    // Replay re-streams the persisted events identically (SAME reducer). Wait
    // for the events probe to settle + the effect to open the replay stream.
    await waitFor(() => expect(fake.openSseStream).toHaveBeenCalled())
    await fake.emitOpen()
    fake.emit(goldenSuccess)
    await fake.close()

    // The replayed frames fill the SAME timeline (mode='replay').
    await waitFor(() =>
      expect(screen.getByLabelText('Event timeline')).toHaveAttribute(
        'data-mode',
        'replay',
      ),
    )
    // The golden sequence's frame-kind labels render in the timeline.
    expect(screen.getByText('Flow started')).toBeInTheDocument()
    expect(screen.getByText('Flow done')).toBeInTheDocument()
  })

  it('a TERMINAL run INSTANT-FILLS the SAME timeline (mode=replay, no auto-scroll)', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: RUN_PATH, body: { ...runMetaFixture, status: 'done' } },
      { method: 'GET', path: EVENTS_PATH, body: runEventsFixture },
    ])
    renderDetail()
    await screen.findByText('Done')

    await waitFor(() => expect(fake.openSseStream).toHaveBeenCalled())
    await fake.emitOpen()
    fake.emit(goldenSuccess)
    await fake.close()

    // The whole golden run lands at once through the SAME reducer/renderer.
    await waitFor(() => {
      const tl = screen.getByLabelText('Event timeline')
      expect(tl).toHaveAttribute('data-mode', 'replay')
    })
    // All four golden frame kinds rendered (identical to a live render).
    expect(screen.getByText('Flow started')).toBeInTheDocument()
    expect(screen.getByText('Node started')).toBeInTheDocument()
    expect(screen.getByText('Node finished')).toBeInTheDocument()
    expect(screen.getByText('Flow done')).toBeInTheDocument()
    // The terminal outputs land in the ONE result panel.
    expect(screen.getByLabelText('Run result')).toBeInTheDocument()
  })

  it('a RUNNING run tails live: events render + ConnectionBadge shows Streaming', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: RUN_PATH, body: { ...runMetaFixture, status: 'running', finished_at: undefined } },
      { method: 'GET', path: EVENTS_PATH, body: runEventsFixture },
    ])
    renderDetail()
    await screen.findByText('Running')

    // Hydrate the events-so-far and KEEP the stream open (no close) → streaming.
    await waitFor(() => expect(fake.openSseStream).toHaveBeenCalled())
    await fake.emitOpen()
    fake.emit(goldenSuccess.slice(0, 2)) // flow_started, node_started

    // The timeline mounts in LIVE mode (auto-scroll follows) for a running run.
    await waitFor(() =>
      expect(screen.getByLabelText('Event timeline')).toHaveAttribute(
        'data-mode',
        'live',
      ),
    )
    // The connection badge shows Streaming (stream open, no terminal yet).
    expect(await screen.findByText('Streaming')).toBeInTheDocument()
    expect(screen.getByText('Flow started')).toBeInTheDocument()
  })

  it('empty /events (200 {events:[]}) → "No events recorded." empty state, NOT an error', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: RUN_PATH, body: { ...runMetaFixture, status: 'done' } },
      { method: 'GET', path: EVENTS_PATH, body: runEventsEmpty },
    ])
    renderDetail()
    await screen.findByText('Done')

    // /events returned {events:[]} → no replay is opened; the empty state shows.
    expect(await screen.findByText('No events recorded.')).toBeInTheDocument()
    expect(screen.getByText('This run produced no events.')).toBeInTheDocument()
    // It is NOT an error state.
    expect(screen.queryByText(/from flowd/)).toBeNull()
    // No timeline frames rendered.
    expect(screen.queryByLabelText('Event timeline')).toBeNull()
  })

  it('hides the Replay CTA while the run status is running (Non-Blocking Rec #4)', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: RUN_PATH, body: { ...runMetaFixture, status: 'running', finished_at: undefined } },
      { method: 'GET', path: EVENTS_PATH, body: runEventsEmpty },
    ])
    renderDetail()
    await screen.findByText('Running')

    expect(screen.queryByRole('button', { name: 'Replay' })).toBeNull()
  })

  it('shows the Replay CTA on a terminal run', async () => {
    installFlowdFetchMock([
      { method: 'GET', path: RUN_PATH, body: { ...runMetaFixture, status: 'done' } },
      { method: 'GET', path: EVENTS_PATH, body: runEventsEmpty },
    ])
    renderDetail()

    expect(
      await screen.findByRole('button', { name: 'Replay' }),
    ).toBeInTheDocument()
  })

  it('renders a flow_err run output as escaped text — no markup injected (T-03-V5)', async () => {
    installFlowdFetchMock([
      {
        method: 'GET',
        path: RUN_PATH,
        body: {
          ...runMetaFixture,
          status: 'failed',
          error: '<img src=x onerror=alert(1)>',
        },
      },
      { method: 'GET', path: EVENTS_PATH, body: runEventsEmpty },
    ])
    const { container } = renderDetail()

    expect(await screen.findByText('Failed')).toBeInTheDocument()
    // The error string renders as literal text in the summary, no <img>.
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })
})
