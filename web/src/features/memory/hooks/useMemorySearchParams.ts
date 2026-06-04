import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback } from 'react'

/**
 * TanStack Router search-param bridge for the Memory console.
 *
 * ALL reproducible/shareable search state lives in the URL (D-02): the recall
 * query + top_k, the open-drawer item id, and the Advanced client-filter fields.
 * Setters write through `navigate({ search })` so a link captures the whole
 * search.
 *
 * NOT here (deliberate): the table's ordering and windowing controls. Those are
 * ephemeral, client-side table state (D-03 — the gateway exposes no server
 * ordering/windowing levers), so they are local @tanstack/react-table state,
 * never URL params. The recall request itself carries only query + top_k
 * (+ consistency_level).
 */
export type MemorySearch = {
  query?: string
  top_k?: number
  item?: string
  scoreThreshold?: number
  pinnedOnly?: boolean
  disabledFilter?: 'hide' | 'only'
}

/** top_k is clamped to the gateway's accepted range (1..50) before it is used. */
export const TOP_K_MIN = 1
export const TOP_K_MAX = 50
export const TOP_K_DEFAULT = 8

export function clampTopK(value: number | undefined): number {
  if (value == null || Number.isNaN(value)) return TOP_K_DEFAULT
  return Math.min(TOP_K_MAX, Math.max(TOP_K_MIN, Math.trunc(value)))
}

export function useMemorySearchParams() {
  const search = useSearch({ from: '/memory' }) as MemorySearch
  const navigate = useNavigate({ from: '/memory' })

  const setSearch = useCallback(
    (next: Partial<MemorySearch>) => {
      void navigate({
        search: (prev: MemorySearch) => ({ ...prev, ...next }),
      })
    },
    [navigate],
  )

  const query = search.query ?? ''
  const top_k = clampTopK(search.top_k)

  return {
    // Read state
    query,
    top_k,
    item: search.item,
    scoreThreshold: search.scoreThreshold,
    pinnedOnly: search.pinnedOnly,
    disabledFilter: search.disabledFilter,
    // Writers (URL is the source of truth — D-02)
    setSearch,
    setQuery: (q: string) => setSearch({ query: q }),
    setTopK: (k: number) => setSearch({ top_k: clampTopK(k) }),
    setItem: (id: string | undefined) => setSearch({ item: id }),
    setScoreThreshold: (v: number | undefined) =>
      setSearch({ scoreThreshold: v }),
    setPinnedOnly: (v: boolean | undefined) => setSearch({ pinnedOnly: v }),
    setDisabledFilter: (v: 'hide' | 'only' | undefined) =>
      setSearch({ disabledFilter: v }),
  }
}
