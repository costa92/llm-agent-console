import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { OperatorContextProvider } from '@/app/OperatorContextProvider'
import { routeTree } from '@/app/router'

function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <OperatorContextProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </OperatorContextProvider>,
  )
}

describe('NavBar', () => {
  beforeEach(() => {
    localStorage.clear()
    // TopBar's env query hits fetch; stub it so the shell renders in tests.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ env: 'test', memory_base: 'http://m' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders Memory, Flow, Chat nav links', async () => {
    renderAt('/memory')
    const nav = await screen.findByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: /Memory/ })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /Flow/ })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /Chat/ })).toBeInTheDocument()
  })

  it('applies the blue accent class to the active route link only', async () => {
    renderAt('/memory')
    const nav = await screen.findByRole('navigation', { name: 'Primary' })
    const memoryLink = within(nav).getByRole('link', { name: /Memory/ })
    const flowLink = within(nav).getByRole('link', { name: /Flow/ })
    expect(memoryLink.className).toContain('nav-active')
    expect(flowLink.className).not.toContain('nav-active')
  })
})

describe('OperatorContextBar', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ env: 'test', memory_base: 'http://m' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders an unset (amber) treatment when tenantId is empty', async () => {
    renderAt('/memory')
    // Both TENANT and USER show "not set" copy when context is empty.
    const notSet = await screen.findAllByText('not set')
    expect(notSet.length).toBeGreaterThanOrEqual(2)
  })

  it('renders tenant/user values in monospace when set', async () => {
    localStorage.setItem(
      'operator-context',
      JSON.stringify({
        tenantId: 'acme',
        userId: 'u-1',
        projectId: '',
        sessionId: '',
      }),
    )
    renderAt('/memory')
    const tenant = await screen.findByText('acme')
    const user = await screen.findByText('u-1')
    expect(tenant.className).toContain('mono')
    expect(user.className).toContain('mono')
  })
})
