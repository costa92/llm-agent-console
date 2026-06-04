import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useDeleteFlow } from '../hooks/useFlowMutations'

/**
 * DeleteFlowDialog — the red destructive delete-confirm (IC-1, Phase-1 pattern).
 *
 * Reuses the Phase-2 LifecycleActions red destructive-dialog pattern: a RED
 * dialog titled "Delete flow?" stating it deletes `{flow.id}` AND its run
 * history, irreversible; the Confirm button repeats the verb "Delete"
 * (destructive red); Cancel is focused by default (the low-risk action).
 *
 * On confirm → useDeleteFlow(id). A 204 is success (the client parses no body;
 * Pitfall 5) — the hook fires "Flow deleted." and we navigate back to /flows
 * (PESSIMISTIC: only after the 204, D-11). A failure (e.g. 404) shows the
 * hook's verbatim error toast and we do NOT navigate (the dialog closes; the
 * operator stays on the detail).
 *
 * The flowId renders into the dialog body as a React TEXT node (T-03-V5).
 */
export function DeleteFlowDialog({ flowId }: { flowId: string }) {
  const navigate = useNavigate()
  const deleteM = useDeleteFlow()
  const [open, setOpen] = useState(false)

  function confirmDelete() {
    deleteM.mutate(flowId, {
      onSuccess: () => {
        // Pessimistic: navigate back only after the 204 landed.
        setOpen(false)
        void navigate({ to: '/flows' })
      },
      onError: () => {
        // The hook already toasted the verbatim failure; stay on the detail.
        setOpen(false)
      },
    })
  }

  return (
    <>
      <Button
        variant="destructive"
        onClick={() => setOpen(true)}
        disabled={deleteM.isPending}
      >
        {deleteM.isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Trash2 className="size-4" aria-hidden />
        )}
        Delete flow
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete flow?</DialogTitle>
            <DialogDescription>
              This permanently deletes {flowId} and its run history. This cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {/* Cancel is the default-focused, low-risk action. */}
            <Button
              variant="outline"
              autoFocus
              onClick={() => setOpen(false)}
              disabled={deleteM.isPending}
            >
              Cancel
            </Button>
            {/* Red confirm repeating the verb. */}
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteM.isPending}
            >
              {deleteM.isPending && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
