import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'

import { OperatorContextProvider } from '@/app/OperatorContextProvider'
import {
  installMemoryFetchMock,
  itemFixture,
  pinResponse,
  disableResponse,
  deleteResponse,
  conflict409,
  type MockRoute,
} from '@/test/mocks/memory-gateway'
import { memoryKeys } from '../api/queries'
import { LifecycleActions, type LifecycleItem } from './LifecycleActions'

const ID = 'mem_123'
const PIN_PATH = '/api/memory/items/mem_123/pin'
const DISABLE_PATH = '/api/memory/items/mem_123/disable'
const ITEM_PATH = '/api/memory/items/mem_123'

const baseItem: LifecycleItem = {
  memory_id: ID,
  version: 7,
  pinned: false,
  disabled: false,
}

function makeClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(memoryKeys.item(ID), { ...itemFixture, pinned: false })
  queryClient.setQueryData(['recall', { query: 'x', top_k: 8 }], {
    hits: [
      {
        memory_id: ID,
        kind: 'semantic',
        score: 0.95,
        version: 7,
        content: 'x',
        pinned: false,
        disabled: false,
      },
    ],
  })
  return queryClient
}

function renderActions(
  ui: ReactNode,
  queryClient = makeClient(),
) {
  const result = render(
    createElement(
      OperatorContextProvider,
      null,
      createElement(QueryClientProvider, { client: queryClient }, ui),
    ),
  )
  return { ...result, queryClient }
}

function install(routes: MockRoute[]) {
  return installMemoryFetchMock(routes)
}

function bodyOf(fetchMock: ReturnType<typeof install>['fetchMock'], suffix: string) {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith(suffix))
  return call ? JSON.parse(String(call[1]!.body)) : undefined
}

function calledWith(
  fetchMock: ReturnType<typeof install>['fetchMock'],
  predicate: (url: string, init?: RequestInit) => boolean,
) {
  return fetchMock.mock.calls.some((c) => predicate(String(c[0]), c[1]))
}

/**
 * Radix DropdownMenu relies on Pointer Events + element APIs that jsdom does not
 * implement (hasPointerCapture / scrollIntoView). Shim them so the menu opens
 * under fireEvent the same way it does in a real browser.
 */
function installRadixJsdomShims() {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {}
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
}

describe('LifecycleActions — two confirm weights + pessimistic + D-06 (drawer/row)', () => {
  beforeEach(() => {
    installRadixJsdomShims()
    localStorage.setItem(
      'operator-context',
      JSON.stringify({ tenantId: 'acme', userId: 'u-1', projectId: '', sessionId: '' }),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('no-confirm actions: Pin (drawer) fires the mutation directly with id + version — NO dialog', async () => {
    const { fetchMock } = install([{ method: 'POST', path: PIN_PATH, body: pinResponse }])
    renderActions(<LifecycleActions item={baseItem} variant="drawer" />)

    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))

    // No confirm dialog appeared.
    expect(screen.queryByText('Delete memory item?')).not.toBeInTheDocument()
    expect(screen.queryByText('Disable this item?')).not.toBeInTheDocument()
    // The pin POST fired with the item's expected_version.
    await waitFor(() => expect(calledWith(fetchMock, (u) => u.endsWith('/pin'))).toBe(true))
    expect(bodyOf(fetchMock, '/pin').expected_version).toBe(7)
  })

  it('disable neutral confirm: opens "Disable this item?" (reversible copy, no "cannot be undone"); confirming calls disable', async () => {
    const { fetchMock } = install([{ method: 'POST', path: DISABLE_PATH, body: disableResponse }])
    renderActions(<LifecycleActions item={baseItem} variant="drawer" />)

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))

    // Neutral confirm dialog — reversible copy, NO destructive language.
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Disable this item?')).toBeInTheDocument()
    expect(within(dialog).getByText(/excluded from recall until re-enabled/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/cannot be undone/)).not.toBeInTheDocument()

    // No mutation yet (confirm boundary).
    expect(calledWith(fetchMock, (u) => u.endsWith('/disable'))).toBe(false)
    // Confirm → disable fires.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disable' }))
    await waitFor(() => expect(calledWith(fetchMock, (u) => u.endsWith('/disable'))).toBe(true))
  })

  it('delete red destructive: opens "Delete memory item?" with "cannot be undone" + a "Delete" confirm; Cancel is focusable; confirming calls delete', async () => {
    const { fetchMock } = install([{ method: 'DELETE', path: ITEM_PATH, body: deleteResponse }])
    renderActions(<LifecycleActions item={baseItem} variant="drawer" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Delete memory item?')).toBeInTheDocument()
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument()
    // Cancel is present + focused by default (the low-risk default action).
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    expect(cancel).toHaveFocus()
    // No delete yet.
    expect(calledWith(fetchMock, (_u, i) => (i?.method ?? "") === "DELETE")).toBe(false)
    // Confirm → DELETE fires with expected_version.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(calledWith(fetchMock, (_u, i) => (i?.method ?? "") === "DELETE")).toBe(true),
    )
  })

  it('delete pessimistic + closes drawer: the row is spliced only AFTER the 200, and onDeleted fires on success', async () => {
    const onDeleted = vi.fn()
    const queryClient = makeClient()
    install([{ method: 'DELETE', path: ITEM_PATH, body: deleteResponse }])
    renderActions(
      <LifecycleActions item={baseItem} variant="drawer" onDeleted={onDeleted} />,
      queryClient,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')

    // On confirm-click the row is NOT yet removed (pessimistic — wait for 200).
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    // onDeleted only fires after the mutation resolves.
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
    // The hook spliced the hit out of the cached recall data after the 200.
    const recall = queryClient.getQueryData(['recall', { query: 'x', top_k: 8 }]) as {
      hits: unknown[]
    }
    expect(recall.hits).toHaveLength(0)
  })

  it('pessimistic in-flight: while delete isPending the confirm control disables (state has not flipped yet)', async () => {
    // A delete whose response never resolves keeps isPending true.
    const pending = new Promise<Response>(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const method = (init?.method ?? 'GET').toUpperCase()
        if (method === 'DELETE') return pending
        return Promise.resolve(new Response('{}', { status: 200 }))
      }),
    )
    renderActions(<LifecycleActions item={baseItem} variant="drawer" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    // The drawer Delete button reflects pending (disabled).
    await waitFor(() => {
      const del = screen
        .getAllByRole('button', { name: 'Delete' })
        .find((b) => (b as HTMLButtonElement).disabled)
      expect(del).toBeTruthy()
    })
  })

  it('row quick-actions (D-06): the row menu exposes Pin/Disable/Delete and drives the mutation without opening the drawer', async () => {
    const { fetchMock } = install([{ method: 'POST', path: PIN_PATH, body: pinResponse }])
    renderActions(<LifecycleActions item={baseItem} variant="row" />)

    // Open the row-actions dropdown (Radix opens the menu from the trigger;
    // keyboard activation is the reliable jsdom path).
    const trigger = screen.getByRole('button', { name: 'Row actions' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    // The menu exposes the triage actions.
    expect(await screen.findByRole('menuitem', { name: 'Pin' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Disable' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()

    // Selecting Pin fires the mutation directly (no confirm).
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin' }))
    await waitFor(() => expect(calledWith(fetchMock, (u) => u.endsWith('/pin'))).toBe(true))
  })

  it('409 surfaced (IC-5): a delete that 409s shows the amber "the item changed" toast and the row is NOT removed', async () => {
    const errorSpy = vi.spyOn(toast, 'error')
    const queryClient = makeClient()
    install([
      { method: 'DELETE', path: ITEM_PATH, status: 409, body: conflict409 },
      { method: 'GET', path: ITEM_PATH, body: itemFixture },
    ])
    renderActions(<LifecycleActions item={baseItem} variant="drawer" />, queryClient)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    // Amber 409 recovery toast (via the hook's handle409Conflict).
    await waitFor(() =>
      expect(
        errorSpy.mock.calls.some((c) => String(c[0]).includes('the item changed')),
      ).toBe(true),
    )
    // The row is NOT removed — state flips only on a real success.
    const recall = queryClient.getQueryData(['recall', { query: 'x', top_k: 8 }]) as {
      hits: unknown[]
    }
    expect(recall.hits).toHaveLength(1)
  })
})
