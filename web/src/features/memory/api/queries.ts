import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { makeApiFetcher } from '@/lib/api'
import { useOperatorContext } from '@/app/OperatorContextProvider'
import { recall, getItem, type RecallParams } from './client'

/**
 * TanStack Query key factory + recall/item hooks.
 *
 * The recall key is `['recall', params]` where params = {query, top_k,
 * consistency_level} — the ONLY things that trigger a server re-query. Sort,
 * page, and client-side state filters are NOT in the key: they are applied
 * client-side over the already-fetched top-k hits (D-03/D-13), so changing them
 * must not re-POST recall.
 */
export const memoryKeys = {
  recall: (params: RecallParams) => ['recall', params] as const,
  item: (id: string) => ['memory-item', id] as const,
}

/**
 * Per-item PARTIAL marker keys (D-09 cardinal-sin guard). A mutation whose
 * follow-up GET-item refetch fails writes `{message}` here (via setQueryData) so
 * the open drawer can render the amber "Showing partial data" banner over the
 * stale body without re-deriving it from the mutation. A successful refresh
 * clears it. This is console-local UI state stored in the cache so the
 * EditorDrawer (which closes on the 200) and the ItemDrawer (which stays open
 * and reads it) communicate without prop drilling.
 */
export const partialKeys = {
  itemPartial: (id: string) => ['memory-item-partial', id] as const,
}

/** Read the per-item partial marker the mutations set on a refetch-after fail. */
export function useItemPartial(id: string | undefined) {
  return useQuery({
    queryKey: partialKeys.itemPartial(id ?? ''),
    // No queryFn: this key is only ever written via setQueryData. Disabled so it
    // never fetches; we just observe whatever the mutation hooks wrote.
    queryFn: () => null as { message: string } | null,
    enabled: false,
  })
}

/**
 * Build the Phase-1 apiFetch from the current operator context so the
 * `X-Console-*` identity headers are injected (the BFF re-materializes
 * authoritative scope). This is the ONLY identity-injection point — the client
 * fetchers never set identity headers themselves.
 */
function useApiFetch() {
  const ctx = useOperatorContext()
  return useMemo(
    () =>
      makeApiFetcher({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        projectId: ctx.projectId,
        sessionId: ctx.sessionId,
      }),
    [ctx.tenantId, ctx.userId, ctx.projectId, ctx.sessionId],
  )
}

/**
 * Recall query. Enabled only when params.query is non-empty so an empty-query
 * POST (a guaranteed 400 "query is required") is never fired.
 */
export function useRecallQuery(params: RecallParams) {
  const apiFetch = useApiFetch()
  return useQuery({
    queryKey: memoryKeys.recall(params),
    queryFn: () => recall(apiFetch, params),
    enabled: params.query.trim().length > 0,
  })
}

/** Item-detail query. Enabled only when an id is set (drawer open). */
export function useItemQuery(id: string | undefined) {
  const apiFetch = useApiFetch()
  return useQuery({
    queryKey: memoryKeys.item(id ?? ''),
    queryFn: () => getItem(apiFetch, id as string),
    enabled: !!id,
  })
}
