import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { runSync, FlowdError, type RunSyncResult } from '../api/client'
import { flowKeys } from '../api/queries'

/**
 * Synchronous-run mutation (D-04, the secondary "Run (sync)" trigger). Wraps the
 * 03-01 `runSync` (POST /flows/{id}/run → {outputs, run_id}) with the Phase-1
 * toast formula:
 *   - start   → "Run started."
 *   - success → "Run complete."
 *   - failure → "Run failed — {status}: {verbatim flowd message}." + Copy-error
 *
 * On success it invalidates `flowKeys.runs(flowId)` so Slice C's run history
 * refreshes after the run (a sync run also produces a persisted run). The
 * {outputs} render into the shared RunResultPanel (ONE result surface, D-04) —
 * the caller reads `mutation.data?.outputs`.
 *
 * No Authorization / X-Console-* is added here (the 03-01 client omits them;
 * the BFF injects the flowd bearer — T-03-08).
 */

export type UseSyncRun = ReturnType<typeof useSyncRun>

export function useSyncRun(flowId: string) {
  const queryClient = useQueryClient()
  return useMutation<RunSyncResult, unknown, Record<string, string>>({
    mutationFn: (inputs) => {
      toast.success('Run started.')
      return runSync(flowId, inputs)
    },
    onSuccess: () => {
      toast.success('Run complete.')
      void queryClient.invalidateQueries({ queryKey: flowKeys.runs(flowId) })
    },
    onError: (err) => {
      const status = err instanceof FlowdError ? err.status : 0
      const message = err instanceof Error ? err.message : 'request failed'
      const text = `Run failed — ${status}: ${message}.`
      toast.error(text, {
        action: {
          label: 'Copy error',
          onClick: () => {
            void navigator.clipboard?.writeText(text)
          },
        },
      })
    },
  })
}
