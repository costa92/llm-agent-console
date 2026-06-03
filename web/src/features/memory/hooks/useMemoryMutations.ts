import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'

import { makeApiFetcher } from '@/lib/api'
import { useOperatorContext } from '@/app/OperatorContextProvider'
import { reportError } from '@/components/shell/OperatorContextBar'
import {
  write,
  patch,
  getItem,
  type ApiFetch,
  type NormalizedGatewayError,
  type WriteResponse,
  type MutationVersionResponse,
} from '../api/client'
import { memoryKeys, partialKeys } from '../api/queries'
import type { WriteRecord, PatchFields } from '../api/schemas'

/**
 * Write/patch mutations + the shared 409 OCC-recovery helper (Slice C-1).
 *
 * D-09 (refetch-after, hybrid): write/patch return ONLY a lean
 * `{memory_id, version}` (no body). We NEVER trust that lean response for the
 * item body — on success we refetch `GET /memory/items/{id}` to get the
 * authoritative content. The recall row's `version` is merged in place (no
 * re-recall: search is operator-initiated, D-09).
 *
 * Cardinal-sin guard (D-09 / UI-SPEC "Partial state"): the refetch-after is
 * wrapped in try/catch. If the mutation returned 200 but the follow-up GET item
 * refetch FAILS, we do NOT discard the success and do NOT raise a generic red
 * error — the change DID land. We fire the success toast, merge the new version
 * onto the recall row from the lean response, and SET A PARTIAL SIGNAL (in the
 * query cache, keyed per item) so the open drawer renders the amber
 * "Showing partial data — couldn't refresh the item body; the change was saved."
 * banner over the (now stale) body, rather than silently showing stale content.
 *
 * D-11 (pessimistic): the in-flight UI is driven by the mutation's `isPending`;
 * there are no optimistic cache flips.
 *
 * IC-5 (409 first-class): a stale `expected_version` patch rejects with
 * `memory_conflict`; `handle409Conflict` surfaces the amber recovery (toast +
 * auto-refetch GET item to load the new version) and resolves so the caller can
 * re-enable submit for a retry — never a silent retry loop, never a red error.
 *
 * EXTENSION POINT — plan 05 adds `usePinMutation` / `useDisableMutation` /
 * `useDeleteMutation` to THIS file, reusing `handle409Conflict`, the same
 * success/failure toast + version-threading conventions, AND the same
 * refetch-fail → partial-banner treatment for any of their refetch paths.
 */

/**
 * Copy for the amber partial banner when a 200 mutation's body refetch fails.
 * FiveStateWrapper prepends the fixed prefix, so the rendered banner reads:
 * "Showing partial data — couldn't refresh the item body; the change was saved."
 */
export const REFETCH_PARTIAL_MESSAGE =
  "couldn't refresh the item body; the change was saved"

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

/** Narrow an unknown mutation error to the client's normalized gateway error. */
function asGatewayError(err: unknown): NormalizedGatewayError | null {
  if (
    typeof err === 'object' &&
    err != null &&
    'error' in err &&
    'httpStatus' in err
  ) {
    return err as NormalizedGatewayError
  }
  return null
}

/**
 * Shared first-class 409 OCC-recovery (IC-5). When `err` is a
 * `memory_conflict`, fire the amber "the item changed. Refreshing…" toast
 * (+ Copy error, SHELL-06), auto-refetch GET item to load the new version, and
 * return `true` (handled) so the caller skips the generic red failure toast and
 * re-enables submit for a retry. Returns `false` for any other error so the
 * caller falls through to the generic failure path.
 *
 * Reused by plan 05's flag/delete mutations.
 */
export async function handle409Conflict(
  err: unknown,
  id: string,
  opts: {
    actionLabel: string
    queryClient: ReturnType<typeof useQueryClient>
    apiFetch: ApiFetch
  },
): Promise<boolean> {
  const gw = asGatewayError(err)
  if (gw?.error.code !== 'memory_conflict') return false

  const text = `${opts.actionLabel} failed — 409: the item changed. Refreshing…`
  toast.error(text, {
    action: {
      label: 'Copy error',
      onClick: () => {
        void navigator.clipboard?.writeText(text)
      },
    },
  })

  // Auto-refetch GET item to load the fresh version so the operator can retry
  // against the new state. Clear any stale partial marker on the way. fetchQuery
  // (not invalidate/refetchQueries) so the GET fires unconditionally — even if no
  // drawer observer is currently mounted (then re-populates the cache for it).
  opts.queryClient.setQueryData(partialKeys.itemPartial(id), null)
  try {
    await opts.queryClient.fetchQuery({
      queryKey: memoryKeys.item(id),
      queryFn: () => getItem(opts.apiFetch, id),
    })
  } catch {
    // A failed refresh here is non-fatal: the conflict toast already told the
    // operator the item changed; the next manual refresh will reconcile.
  }
  return true
}

/**
 * Merge a new `version` onto the matching recall hit IN PLACE — never re-runs
 * recall (D-09: search is operator-initiated). Touches every cached recall
 * query (keyed `['recall', ...]`) and updates the hit whose memory_id matches.
 */
function mergeRecallVersion(
  queryClient: ReturnType<typeof useQueryClient>,
  memoryId: string,
  version: number,
) {
  queryClient.setQueriesData(
    { queryKey: ['recall'] },
    (prev: unknown) => {
      if (
        typeof prev !== 'object' ||
        prev == null ||
        !('hits' in prev) ||
        !Array.isArray((prev as { hits: unknown[] }).hits)
      ) {
        return prev
      }
      const data = prev as { hits: Array<{ memory_id: string }> }
      return {
        ...data,
        hits: data.hits.map((hit) =>
          hit.memory_id === memoryId ? { ...hit, version } : hit,
        ),
      }
    },
  )
}

/** Set/clear the per-item partial marker the drawer reads (cardinal-sin guard). */
function setItemPartial(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
  message: string | null,
) {
  queryClient.setQueryData(
    partialKeys.itemPartial(id),
    message ? { message } : null,
  )
}

/**
 * Refetch GET item after a 200 mutation (D-09). On success: clear the partial
 * marker. On FAILURE: keep the success (the mutation landed), set the per-item
 * partial marker so the drawer shows the amber banner — NOT a red error, NOT
 * silent stale content. Returns whether the refetch succeeded.
 */
async function refetchItemAfterMutation(
  queryClient: ReturnType<typeof useQueryClient>,
  apiFetch: ApiFetch,
  id: string,
): Promise<boolean> {
  try {
    // fetchQuery forces the GET unconditionally and writes the authoritative
    // body into the item cache (refetchQueries/invalidateQueries only fire when
    // a drawer observer is already mounted; the guard must hold regardless).
    await queryClient.fetchQuery({
      queryKey: memoryKeys.item(id),
      queryFn: () => getItem(apiFetch, id),
    })
    // The refetch landed — clear any prior partial marker.
    setItemPartial(queryClient, id, null)
    return true
  } catch {
    // The mutation already returned 200; only the body refresh degraded.
    setItemPartial(queryClient, id, REFETCH_PARTIAL_MESSAGE)
    return false
  }
}

export type WriteMutationVars = WriteRecord

/**
 * useWriteMutation — POST /memory/write. The response is lean
 * (`{memory: {memory_id, version, status}}`); on success we fire the terse
 * "Record written." toast and expose the new `memory_id` so the caller can
 * offer to open the new item (set ?item). We refetch GET item for the new id so
 * the offered-open drawer lands on the authoritative body — and if THAT refetch
 * fails, the drawer shows the partial banner rather than a red error (the record
 * was written). Write has no expected_version → no 409 path; any failure
 * (incl. idempotency_conflict) is the generic red SHELL-06 toast. Recall is
 * never auto-re-run (D-09).
 */
export function useWriteMutation() {
  const apiFetch = useApiFetch()
  const queryClient = useQueryClient()

  return useMutation<WriteResponse, unknown, WriteMutationVars>({
    mutationFn: (record) => write(apiFetch, record),
    onSuccess: async (res) => {
      toast.success('Record written.')
      // Refetch the new item's body so an offered-open drawer is authoritative;
      // a refetch failure degrades to the partial banner, not a red error.
      await refetchItemAfterMutation(queryClient, apiFetch, res.memory.memory_id)
    },
    onError: (err) => {
      const gw = asGatewayError(err)
      reportError(
        'Write',
        gw?.httpStatus ?? 0,
        gw?.error.message ?? 'request failed',
      )
    },
  })
}

export type PatchMutationVars = {
  id: string
  patch: PatchFields
  expected_version: number
}

/**
 * usePatchMutation — PATCH /memory/items/{id}. Threads `expected_version` (OCC).
 * The response is lean (`{memory_id, version}`); on success we refetch GET item
 * for the authoritative body (D-09) and merge the new version onto the recall
 * row in place (never re-running recall). The refetch is wrapped so a refetch
 * FAILURE on a 200 mutation surfaces the amber partial banner (success toast
 * still fires) instead of a generic red error. onError: a 409 memory_conflict
 * goes through handle409Conflict (amber recovery + auto-refetch + re-enable
 * retry); any other failure is the generic SHELL-06 red toast.
 */
export function usePatchMutation() {
  const apiFetch = useApiFetch()
  const queryClient = useQueryClient()

  return useMutation<
    MutationVersionResponse,
    unknown,
    PatchMutationVars
  >({
    mutationFn: ({ id, patch: fields, expected_version }) =>
      patch(apiFetch, id, fields, expected_version),
    onSuccess: async (res, vars) => {
      // Always merge the new version onto the recall row from the lean response
      // (works in both the refetch-ok and refetch-failed branches; no re-recall).
      mergeRecallVersion(queryClient, res.memory_id, res.version)
      // The write landed → success toast fires regardless of the refetch outcome.
      toast.success('Patched.')
      // D-09 refetch-after; a refetch failure degrades to the partial banner.
      await refetchItemAfterMutation(queryClient, apiFetch, vars.id)
    },
    onError: async (err, vars) => {
      // IC-5 first: a 409 memory_conflict is the amber recovery, not a red error.
      const handled = await handle409Conflict(err, vars.id, {
        actionLabel: 'Patch',
        queryClient,
        apiFetch,
      })
      if (handled) return
      const gw = asGatewayError(err)
      reportError(
        'Patch',
        gw?.httpStatus ?? 0,
        gw?.error.message ?? 'request failed',
      )
    },
  })
}
