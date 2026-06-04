import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  createFlow,
  putFlow,
  deleteFlow,
  FlowdError,
  type FlowWriteBody,
} from '../api/client'
import { flowKeys } from '../api/queries'
import type { FlowRecord } from '../api/schemas'

/**
 * Flow CRUD mutations (Slice A — create / PUT / delete).
 *
 * Toast formula is the Phase-1 locked one: success is terse past tense
 * ("Flow created." / "Flow saved." / "Flow deleted."); failure is
 * "{Action} failed — {status}: {message}." carrying the VERBATIM flowd flat
 * `{error}` (BFF-04 passthrough) with a Copy-error action. flowd is the
 * authoritative semantic validator — a compile 400 surfaces verbatim here, not
 * a generic string.
 *
 * Pessimistic (D-11): nothing flips optimistically. PUT sends the RAW flow with
 * `id` OMITTED (the client enforces this; Pitfall 4). DELETE treats 204 as
 * success without parsing a body (the client enforces this; Pitfall 5). On
 * success we invalidate `flowKeys.flows` (+ the per-flow key) so the list/detail
 * refetch authoritative data. Navigation (create→/flows/{newId}, delete→/flows)
 * is the caller's concern via onSuccess.
 */

/** Narrow an unknown mutation error to a FlowdError (status + flat message). */
function asFlowdError(err: unknown): FlowdError | null {
  return err instanceof FlowdError ? err : null
}

/** The Phase-1 failure toast: "{Action} failed — {status}: {message}." + Copy. */
function reportFlowError(action: string, err: unknown) {
  const fe = asFlowdError(err)
  const status = fe?.status ?? 0
  const message =
    err instanceof Error ? err.message : 'request failed'
  const text = `${action} failed — ${status}: ${message}.`
  toast.error(text, {
    action: {
      label: 'Copy error',
      onClick: () => {
        void navigator.clipboard?.writeText(text)
      },
    },
  })
}

export type PutFlowVars = {
  id: string
  flow: unknown
  name?: string
}

/**
 * usePutFlow — PUT /flows/{id}. Sends the raw flow + omits id (client-enforced,
 * Pitfall 4). On success: "Flow saved." + invalidate the flow + list. A flowd
 * compile 400 surfaces verbatim ("Save failed — 400: flow compile: …").
 */
export function usePutFlow() {
  const queryClient = useQueryClient()
  return useMutation<FlowRecord, unknown, PutFlowVars>({
    mutationFn: ({ id, flow, name }) => putFlow(id, flow, name),
    onSuccess: (_res, vars) => {
      toast.success('Flow saved.')
      void queryClient.invalidateQueries({ queryKey: flowKeys.flow(vars.id) })
      void queryClient.invalidateQueries({ queryKey: flowKeys.flows() })
    },
    onError: (err) => reportFlowError('Save', err),
  })
}

/**
 * useCreateFlow — POST /flows → 201 FlowRecord. On success: "Flow created." +
 * invalidate the list. The caller routes to /flows/{newId} via onSuccess. A 409
 * duplicate surfaces verbatim ("Create failed — 409: flow … already exists").
 */
export function useCreateFlow() {
  const queryClient = useQueryClient()
  return useMutation<FlowRecord, unknown, FlowWriteBody>({
    mutationFn: (body) => createFlow(body),
    onSuccess: () => {
      toast.success('Flow created.')
      void queryClient.invalidateQueries({ queryKey: flowKeys.flows() })
    },
    onError: (err) => reportFlowError('Create', err),
  })
}

/**
 * useDeleteFlow — DELETE /flows/{id}. A 204 is success (the client parses no
 * body, Pitfall 5). On success: "Flow deleted." + invalidate the list (the
 * caller routes back to /flows via onSuccess — pessimistic, after the 204). A
 * failure (e.g. 404) surfaces verbatim and the caller does NOT navigate.
 */
export function useDeleteFlow() {
  const queryClient = useQueryClient()
  return useMutation<void, unknown, string>({
    mutationFn: (id) => deleteFlow(id),
    onSuccess: (_res, id) => {
      toast.success('Flow deleted.')
      void queryClient.removeQueries({ queryKey: flowKeys.flow(id) })
      void queryClient.invalidateQueries({ queryKey: flowKeys.flows() })
    },
    onError: (err) => reportFlowError('Delete', err),
  })
}
