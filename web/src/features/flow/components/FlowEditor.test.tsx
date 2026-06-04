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

import { FlowDetailPage } from '../FlowDetailPage'
import { FlowEditor } from './FlowEditor'
import {
  installFlowdFetchMock,
  flowRecordFixture,
  flowDefinition,
  flowJsonBase64,
  flowdError400,
  type FlowdMockRoute,
} from '@/test/mocks/flowd'

const FLOW_ID = 'echo_chain'
const FLOW_PATH = `/api/flow/flows/${FLOW_ID}`
const FLOWS_PATH = '/api/flow/flows'

/** Mount FlowDetailPage in EDIT mode at /flows/{id} (drives the real getFlow). */
function renderDetailEdit(routes: FlowdMockRoute[]) {
  const { fetchMock } = installFlowdFetchMock(routes)
  const rootRoute = createRootRoute()
  const flowsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/flows',
    component: () => <div>FLOWS LIST</div>,
  })
  const flowDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/flows/$flowId',
    component: () => <FlowDetailPage mode="edit" flowId={FLOW_ID} />,
  })
  const flowNewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/flows/new',
    component: () => <div>NEW FLOW</div>,
  })
  const routeTree = rootRoute.addChildren([
    flowsRoute,
    flowNewRoute,
    flowDetailRoute,
  ])
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
  return { ...utils, router, fetchMock }
}

/** Mount FlowEditor in CREATE mode under a router (for the POST→201→nav path). */
function renderCreate(routes: FlowdMockRoute[]) {
  const { fetchMock } = installFlowdFetchMock(routes)
  const rootRoute = createRootRoute()
  const flowNewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/flows/new',
    component: () => <FlowEditor mode="create" />,
  })
  const flowDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/flows/$flowId',
    component: () => <div>DETAIL ROUTE</div>,
  })
  const routeTree = rootRoute.addChildren([flowNewRoute, flowDetailRoute])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/flows/new'] }),
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...utils, router, fetchMock }
}

function editor(): HTMLTextAreaElement {
  return screen.getByLabelText('flow json') as HTMLTextAreaElement
}
function saveBtn(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^Save/ }) as HTMLButtonElement
}
function setEditor(value: string) {
  fireEvent.change(editor(), { target: { value } })
}

/** Find the PUT/POST call's parsed JSON body on the fetch mock. */
function bodyOf(call: [unknown, RequestInit?]): Record<string, unknown> {
  return JSON.parse(call[1]!.body as string)
}

describe('FlowEditor — edit mode (S3 / IC-2 base64 round-trip)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('base64-decodes the loaded flow on load — no base64 in the textarea', async () => {
    renderDetailEdit([
      { method: 'GET', path: FLOW_PATH, body: flowRecordFixture },
    ])
    await screen.findByLabelText('flow json')

    const text = editor().value
    // The DECODED flow IR is shown, never the raw base64 string.
    expect(text).not.toContain(flowJsonBase64)
    expect(text).not.toMatch(/eyJ/) // base64 of `{"…` starts with eyJ
    expect(JSON.parse(text)).toEqual(flowDefinition)
  })

  it('malformed JSON disables Save and shows the inline parse error', async () => {
    renderDetailEdit([
      { method: 'GET', path: FLOW_PATH, body: flowRecordFixture },
    ])
    await screen.findByLabelText('flow json')

    setEditor('{ not json')
    await waitFor(() => expect(saveBtn()).toBeDisabled())
    expect(screen.getByText(/Invalid JSON —/)).toBeInTheDocument()
  })

  it('PUT body OMITS id and sends the RAW flow (not base64) on Save', async () => {
    const { fetchMock } = renderDetailEdit([
      { method: 'GET', path: FLOW_PATH, body: flowRecordFixture },
      { method: 'PUT', path: FLOW_PATH, body: flowRecordFixture },
    ])
    await screen.findByLabelText('flow json')

    const edited = { ...flowDefinition, nodes: [{ id: 'upper', type: 'uppercase' }] }
    setEditor(JSON.stringify(edited, null, 2))
    fireEvent.click(saveBtn())

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        (c) => (c[1]?.method ?? 'GET').toUpperCase() === 'PUT',
      )
      expect(put).toBeTruthy()
    })
    const put = fetchMock.mock.calls.find(
      (c) => (c[1]?.method ?? 'GET').toUpperCase() === 'PUT',
    )!
    const body = bodyOf(put as [unknown, RequestInit?])
    // id OMITTED (Pitfall 4); raw flow (an OBJECT, not a base64 string).
    expect(body).not.toHaveProperty('id')
    expect(body.flow).toEqual(edited)
    expect(typeof body.flow).toBe('object')
  })

  it('a flowd 400 compile error surfaces verbatim in an error toast', async () => {
    const { toast } = await import('sonner')
    const errorSpy = vi.spyOn(toast, 'error')

    renderDetailEdit([
      { method: 'GET', path: FLOW_PATH, body: flowRecordFixture },
      { method: 'PUT', path: FLOW_PATH, status: 400, body: flowdError400 },
    ])
    await screen.findByLabelText('flow json')

    setEditor(JSON.stringify(flowDefinition, null, 2))
    fireEvent.click(saveBtn())

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalled()
    })
    const msg = errorSpy.mock.calls[0][0] as string
    // "Save failed — 400: {verbatim flowd message}."
    expect(msg).toBe(
      'Save failed — 400: flow compile: node "upper": unknown type.',
    )
  })
})

describe('FlowEditor — create mode (S3 / IC-2 POST→201→nav)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('seeds a minimal flow-IR skeleton and Save is enabled by default', async () => {
    renderCreate([])
    await screen.findByLabelText('flow json')
    const text = editor().value
    expect(JSON.parse(text)).toEqual({ id: '', nodes: [], edges: [] })
    expect(saveBtn()).not.toBeDisabled()
  })

  it('POST create → 201 → navigates to /flows/{newId}', async () => {
    const created = { ...flowRecordFixture, id: 'new_flow' }
    const { router } = renderCreate([
      { method: 'POST', path: FLOWS_PATH, status: 201, body: created },
    ])
    await screen.findByLabelText('flow json')

    fireEvent.change(screen.getByLabelText('flow id'), {
      target: { value: 'new_flow' },
    })
    setEditor(JSON.stringify({ id: 'new_flow', nodes: [] }, null, 2))
    fireEvent.click(saveBtn())

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/flows/new_flow')
    })
  })
})

describe('FlowEditor — render-as-text (T-03-V5)', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('renders a flow name with markup as literal text — no element injected', async () => {
    const xss = '<img src=x onerror=alert(1)>'
    const { container } = renderDetailEdit([
      {
        method: 'GET',
        path: FLOW_PATH,
        body: { ...flowRecordFixture, name: xss },
      },
    ])
    await screen.findByLabelText('flow json')

    expect(screen.getByText(xss)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })
})
