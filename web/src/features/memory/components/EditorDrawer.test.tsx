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
  patchResponse,
  writeResponse,
  recallNonEmpty,
  type MockRoute,
} from '@/test/mocks/memory-gateway'

const RECALL_PATH = '/api/memory/recall/unified'
const ITEM_PATH = '/api/memory/items/mem_123'
const WRITE_PATH = '/api/memory/write'

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

function renderPage(opts: { path: string; routes?: MockRoute[] }) {
  localStorage.setItem(
    'operator-context',
    JSON.stringify({ tenantId: 'acme', userId: 'u-1', projectId: '', sessionId: '' }),
  )
  const routes = opts.routes ?? [
    { method: 'POST', path: RECALL_PATH, body: recallNonEmpty },
    { method: 'GET', path: ITEM_PATH, body: itemFixture },
    { method: 'POST', path: WRITE_PATH, body: writeResponse },
    { method: 'PATCH', path: ITEM_PATH, body: patchResponse },
  ]
  const { fetchMock } = installMemoryFetchMock(routes)
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

/** The editor textarea (aria-label "editor json"). */
function editor(): HTMLTextAreaElement {
  return screen.getByLabelText('editor json') as HTMLTextAreaElement
}

function submitBtn(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^Submit/ }) as HTMLButtonElement
}

/** Replace the entire textarea value (fireEvent.change — no per-char parsing). */
function setEditor(value: string) {
  fireEvent.change(editor(), { target: { value } })
}

function bodyOf(fetchMock: ReturnType<typeof installMemoryFetchMock>['fetchMock'], method: string) {
  const call = fetchMock.mock.calls.find(
    (c) => (c[1]?.method ?? 'GET').toUpperCase() === method,
  )
  return call ? JSON.parse(String(call[1]!.body)) : undefined
}

describe('EditorDrawer — one editor, two modes (D-07/D-08/IC-3)', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('New record opens write mode pre-filled with the {kind:semantic, content:""} template', async () => {
    renderPage({ path: '/memory' })

    fireEvent.click(await screen.findByRole('button', { name: 'New record' }))
    const ta = await waitFor(() => editor())
    const parsed = JSON.parse(ta.value)
    expect(parsed).toEqual({ kind: 'semantic', content: '' })
    // The template is the record OBJECT only — no envelope fields (T-02C1-01).
    expect(ta.value).not.toMatch(/scope|idempotency_key|expected_version/)
  })

  it('Patch opens patch mode pre-filled with the item patchable fields only (no kind/source/pinned)', async () => {
    renderPage({ path: '/memory?item=mem_123' })

    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('mem_123')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Patch' }))

    const ta = await waitFor(() => editor())
    const parsed = JSON.parse(ta.value)
    // content/category/tags/importance present; kind/source/pinned/disabled absent.
    expect(parsed).toHaveProperty('content')
    expect(parsed).toHaveProperty('category')
    expect(parsed).not.toHaveProperty('kind')
    expect(parsed).not.toHaveProperty('source')
    expect(parsed).not.toHaveProperty('pinned')
  })

  it('parse ladder: invalid JSON shows "Invalid JSON — ..." and disables Submit', async () => {
    renderPage({ path: '/memory' })
    fireEvent.click(await screen.findByRole('button', { name: 'New record' }))
    await waitFor(() => editor())

    setEditor('{ not json ')
    expect(await screen.findByText(/Invalid JSON —/)).toBeInTheDocument()
    expect(submitBtn()).toBeDisabled()
  })

  it('schema ladder (write): empty content shows a schema error and disables Submit', async () => {
    renderPage({ path: '/memory' })
    fireEvent.click(await screen.findByRole('button', { name: 'New record' }))
    await waitFor(() => editor())

    setEditor(JSON.stringify({ kind: 'semantic', content: '' }))
    expect(await screen.findByText(/content: required\./)).toBeInTheDocument()
    expect(submitBtn()).toBeDisabled()

    // A valid record enables Submit.
    setEditor(JSON.stringify({ kind: 'semantic', content: 'hi' }))
    await waitFor(() => expect(submitBtn()).toBeEnabled())
  })

  it('schema ladder (patch): an empty {} patch shows the "at least one" error and disables Submit; a non-patchable key errors', async () => {
    renderPage({ path: '/memory?item=mem_123' })
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('mem_123')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Patch' }))
    await waitFor(() => editor())

    setEditor('{}')
    expect(await screen.findByText(/at least one of content, category, tags, importance/)).toBeInTheDocument()
    expect(submitBtn()).toBeDisabled()

    // A non-patchable key (pinned) is rejected by the strict schema.
    setEditor(JSON.stringify({ pinned: true }))
    await waitFor(() => expect(submitBtn()).toBeDisabled())
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('write submit sends the record OBJECT only (no scope/idempotency_key in the operator JSON)', async () => {
    const { fetchMock } = renderPage({ path: '/memory' })
    fireEvent.click(await screen.findByRole('button', { name: 'New record' }))
    await waitFor(() => editor())

    setEditor(JSON.stringify({ kind: 'semantic', content: 'hello world' }))
    await waitFor(() => expect(submitBtn()).toBeEnabled())
    fireEvent.click(submitBtn())

    await waitFor(() => expect(bodyOf(fetchMock, 'POST')).toBeTruthy())
    const body = bodyOf(fetchMock, 'POST')
    // The console assembled the envelope; record carries the operator object.
    expect(body.record).toEqual({ kind: 'semantic', content: 'hello world' })
    expect(body.scope).toEqual({})
    expect(typeof body.idempotency_key).toBe('string')
  })

  it('patch submit threads expected_version = the open item version', async () => {
    const { fetchMock } = renderPage({ path: '/memory?item=mem_123' })
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('mem_123')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Patch' }))
    await waitFor(() => editor())

    setEditor(JSON.stringify({ content: 'patched body' }))
    await waitFor(() => expect(submitBtn()).toBeEnabled())
    fireEvent.click(submitBtn())

    await waitFor(() => expect(bodyOf(fetchMock, 'PATCH')).toBeTruthy())
    const body = bodyOf(fetchMock, 'PATCH')
    expect(body.expected_version).toBe(itemFixture.version) // 7
    expect(body.patch).toEqual({ content: 'patched body' })
  })

  it('partial banner: a 200 patch whose GET-item refetch fails shows the amber "Showing partial data" banner, "Patched." toast fired, no red error', async () => {
    const { toast } = await import('sonner')
    const successSpy = vi.spyOn(toast, 'success')
    const errorSpy = vi.spyOn(toast, 'error')

    // First GET (drawer open) succeeds; PATCH 200; the refetch GET returns 503.
    let getCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      if (url.includes('/recall/unified')) return json(recallNonEmpty)
      if (url.includes('/items/mem_123') && method === 'PATCH') return json(patchResponse)
      if (url.includes('/items/mem_123') && method === 'GET') {
        getCount += 1
        // First GET (drawer open) ok; the post-patch refetch (2nd) fails 503.
        if (getCount === 1) return json(itemFixture)
        return json(
          {
            error: {
              code: 'unavailable',
              message: 'gateway unavailable',
              request_id: 'req_503',
              retryable: true,
              details: {},
            },
          },
          503,
        )
      }
      throw new Error(`no route: ${method} ${url}`)
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
    await within(dialog).findByText('mem_123')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Patch' }))
    await waitFor(() => editor())
    setEditor(JSON.stringify({ content: 'patched body' }))
    await waitFor(() => expect(submitBtn()).toBeEnabled())
    fireEvent.click(submitBtn())

    // The success toast still fired (the patch DID land).
    await waitFor(() => expect(successSpy).toHaveBeenCalledWith('Patched.'))
    // The drawer surfaces the amber partial banner over the stale body.
    expect(
      await screen.findByText(/Showing partial data — couldn't refresh the item body/),
    ).toBeInTheDocument()
    // No generic red "Patch failed" toast.
    const redFired = errorSpy.mock.calls.some((c) => String(c[0]).includes('Patch failed'))
    expect(redFired).toBe(false)
  })
})
