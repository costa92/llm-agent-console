import { useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { MoreHorizontal } from 'lucide-react'
import {
  usePinMutation,
  useUnpinMutation,
  useDisableMutation,
  useEnableMutation,
  useDeleteMutation,
} from '../hooks/useMemoryMutations'

/**
 * LifecycleActions — pin/unpin/disable/enable/delete controls (Slice C-2).
 *
 * Surfaces (D-06): `variant='row'` renders the controls as dropdown-menu items
 * (the per-row quick-actions menu for fast triage); `variant='drawer'` renders
 * them as a button set (the full action region in the ItemDrawer).
 *
 * Confirm weights (D-10 — two weights / IC-6 by reversibility):
 *   - Pin / Unpin / Enable → fire DIRECTLY, no confirm (reversible, low-risk).
 *   - Disable → a NEUTRAL light confirm (reversible; no destructive-red).
 *   - Delete → the Phase-1 RED destructive dialog (irreversible; repeats the
 *     verb "Delete", states "cannot be undone", Cancel default-focused).
 *
 * Pessimistic in-flight (D-11 / IC-4): the acted control is driven by the
 * mutation's `isPending` — it disables + shows a spinner, and (row variant) the
 * row dims to 0.6 opacity. State flips ONLY after the backend confirms: the
 * hooks reflect `{flag,version}` (or splice the deleted row) in onSuccess. There
 * are NO optimistic flips; a 409 leaves the row in place (the hook's amber
 * handle409Conflict recovery runs instead).
 *
 * Every action threads `item.version` as `expected_version` (OCC, IC-4). The
 * 409 amber recovery is entirely the hook's job — this component only calls the
 * mutations and reflects `isPending`.
 */
export type LifecycleItem = {
  memory_id: string
  version: number
  pinned: boolean
  disabled: boolean
}

export interface LifecycleActionsProps {
  item: LifecycleItem
  variant: 'row' | 'drawer'
  /** Called after a successful delete (drawer passes a handler clearing ?item). */
  onDeleted?: () => void
}

export function LifecycleActions({
  item,
  variant,
  onDeleted,
}: LifecycleActionsProps) {
  const pinM = usePinMutation()
  const unpinM = useUnpinMutation()
  const disableM = useDisableMutation()
  const enableM = useEnableMutation()
  const deleteM = useDeleteMutation()

  // The two confirm dialogs (delete = red destructive, disable = neutral).
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)

  const vars = { id: item.memory_id, expected_version: item.version }
  const anyPending =
    pinM.isPending ||
    unpinM.isPending ||
    disableM.isPending ||
    enableM.isPending ||
    deleteM.isPending

  // ── Action handlers ────────────────────────────────────────────────────────
  // Pin/Unpin/Enable fire directly (no confirm, D-10). Disable/Delete open the
  // appropriate-weight confirm first.
  const onPinToggle = () => {
    if (item.pinned) unpinM.mutate(vars)
    else pinM.mutate(vars)
  }
  const onEnable = () => enableM.mutate(vars)
  const confirmDisable = () => {
    setDisableOpen(false)
    disableM.mutate(vars)
  }
  const confirmDelete = () => {
    setDeleteOpen(false)
    // Pessimistic: the row is removed by the hook's splice on the 200, NOT here.
    deleteM.mutate(vars, {
      onSuccess: () => onDeleted?.(),
    })
  }

  // ── Confirm dialogs (shared across both variants) ──────────────────────────
  const dialogs = (
    <>
      {/* Delete — Phase-1 RED destructive dialog (D-10). Cancel default-focused. */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete memory item?</DialogTitle>
            <DialogDescription>
              This permanently deletes {item.memory_id}. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {/* Cancel is the default-focused, low-risk action. */}
            <Button
              variant="outline"
              autoFocus
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </Button>
            {/* Red confirm repeating the verb. */}
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable — NEUTRAL light confirm (D-10). No destructive-red, reversible copy. */}
      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable this item?</DialogTitle>
            <DialogDescription>
              Disabled items are excluded from recall until re-enabled. You can
              enable it again anytime.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              autoFocus
              onClick={() => setDisableOpen(false)}
            >
              Cancel
            </Button>
            {/* Neutral confirm — NOT destructive-red. */}
            <Button onClick={confirmDisable}>Disable</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  // ── Row variant — dropdown-menu quick-actions (D-06) ───────────────────────
  if (variant === 'row') {
    return (
      <span
        onClick={(e) => e.stopPropagation()}
        className={cn(anyPending && 'pointer-events-none opacity-60')}
        data-pending={anyPending || undefined}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Row actions"
              disabled={anyPending}
            >
              {anyPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <MoreHorizontal className="size-4" aria-hidden />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onPinToggle}>
              {item.pinned ? 'Unpin' : 'Pin'}
            </DropdownMenuItem>
            {item.disabled ? (
              <DropdownMenuItem onSelect={onEnable}>Enable</DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => setDisableOpen(true)}>
                Disable
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDeleteOpen(true)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {dialogs}
      </span>
    )
  }

  // ── Drawer variant — full button set ───────────────────────────────────────
  return (
    <div className="flex flex-wrap gap-2" aria-label="Lifecycle actions">
      <PendingButton
        pending={pinM.isPending || unpinM.isPending}
        variant="outline"
        onClick={onPinToggle}
      >
        {item.pinned ? 'Unpin' : 'Pin'}
      </PendingButton>

      {item.disabled ? (
        <PendingButton
          pending={enableM.isPending}
          variant="outline"
          onClick={onEnable}
        >
          Enable
        </PendingButton>
      ) : (
        <PendingButton
          pending={disableM.isPending}
          variant="outline"
          onClick={() => setDisableOpen(true)}
        >
          Disable
        </PendingButton>
      )}

      <PendingButton
        pending={deleteM.isPending}
        variant="destructive"
        onClick={() => setDeleteOpen(true)}
      >
        Delete
      </PendingButton>

      {dialogs}
    </div>
  )
}

/**
 * A button whose in-flight state disables it + shows a spinner (pessimistic,
 * D-11). State flips only after the mutation resolves.
 */
function PendingButton({
  pending,
  variant,
  onClick,
  children,
}: {
  pending: boolean
  variant: 'outline' | 'destructive'
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      variant={variant}
      onClick={onClick}
      disabled={pending}
      className={cn(pending && 'opacity-60')}
      data-pending={pending || undefined}
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </Button>
  )
}
