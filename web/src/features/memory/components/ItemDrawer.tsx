import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { CopyableId } from '@/components/primitives/CopyableId'
import { RawJsonViewer } from '@/components/primitives/RawJsonViewer'
import { FiveStateWrapper } from '@/components/primitives/FiveStateWrapper'
import { useItemQuery, useItemPartial } from '@/features/memory/api/queries'
import type { MemoryItem } from '@/features/memory/api/schemas'
import type { NormalizedGatewayError } from '@/features/memory/api/client'
import { useMemorySearchParams } from '../hooks/useMemorySearchParams'
import { DisabledBadge, PinnedBadge } from './StateBadges'
import { EditorDrawer } from './EditorDrawer'
import { LifecycleActions } from './LifecycleActions'

/**
 * Item detail drawer — Slice B (MEM-02 / D-04/D-05 / IC-2).
 *
 * The open item id is the `?item={id}` URL search param (the source of truth,
 * D-05): the drawer opens when `?item` is set, so a reload reopens it and the
 * link is shareable; closing clears the param via the search-params setter so
 * browser-back closes it. The drawer slides over the results list (the list
 * stays mounted/visible behind the scrim).
 *
 * On open it drives `useItemQuery(item)` (02-01, GET /api/memory/items/{id}) and
 * renders the item's fields + the Phase-1 RawJsonViewer (collapsed) + CopyableId.
 * Five-state (IC-2): loading (GET in flight) → ready (rendered fields). A 404
 * `not_found` lands as the ERROR state INSIDE the drawer — there is NO empty
 * state, because an id implies the item should exist.
 *
 * The action region hosts the "Patch" editor (02-04: EditorDrawer patch mode) and
 * LifecycleActions (02-05: pin/unpin/disable/enable/delete + two confirm weights + OCC),
 * both wired in below via `variant="drawer"`.
 */
export function ItemDrawer() {
  const { item, setItem } = useMemorySearchParams()
  const open = Boolean(item)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // Closing is URL-driven: clear ?item (browser-back also clears it). We
        // only ever react to the close edge — opening is done by writing ?item.
        if (!next) setItem(undefined)
      }}
    >
      <SheetContent
        side="right"
        // Fixed 480px desktop side-sheet (UI-SPEC Spacing); md content padding.
        className="w-[480px] gap-0 p-4 sm:max-w-[480px]"
      >
        {item ? <ItemDrawerBody id={item} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function ItemDrawerBody({ id }: { id: string }) {
  const itemQuery = useItemQuery(id)
  // D-09 cardinal-sin guard: a mutation whose refetch-after failed writes a
  // per-item partial marker; surface it as the amber "Showing partial data"
  // banner over the (stale) body — never silent stale content, never a red error.
  const partialQuery = useItemPartial(id)
  const partial = partialQuery.data ?? null

  const gatewayError = itemQuery.error as
    | NormalizedGatewayError
    | null
    | undefined
  const errorState =
    gatewayError != null
      ? {
          // A 404 not_found surfaces here as the error state per IC-2 (NOT empty).
          status: gatewayError.httpStatus,
          service: 'memory-gateway',
          message: gatewayError.error.message,
        }
      : null

  const data = itemQuery.data

  return (
    <>
      <SheetHeader className="px-0 pt-0">
        <SheetTitle>Memory item</SheetTitle>
        <SheetDescription className="sr-only">
          Full record for the selected memory item.
        </SheetDescription>
      </SheetHeader>

      <FiveStateWrapper
        loading={itemQuery.isLoading}
        error={errorState}
        partial={partial}
        onRetry={() => void itemQuery.refetch()}
      >
        {data != null && <ItemDetail item={data} />}
      </FiveStateWrapper>
    </>
  )
}

/** A single rendered field row: a Label key + a value node. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="text-xs font-semibold uppercase"
        style={{ color: 'var(--muted-foreground)', letterSpacing: '0.04em' }}
      >
        {label}
      </span>
      {children}
    </div>
  )
}

function ItemDetail({ item }: { item: MemoryItem }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Header: copyable id (mono) + lifecycle badges. */}
      <div className="flex flex-wrap items-center gap-2">
        <CopyableId id={item.memory_id} />
        {item.pinned && <PinnedBadge />}
        {item.disabled && <DisabledBadge />}
      </div>

      {/* Field grid — keys are Label, values per UI-SPEC typography. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Kind">
          <span className="text-sm" style={{ color: 'var(--foreground)' }}>
            {item.kind}
          </span>
        </Field>
        <Field label="Version">
          <span className="mono text-sm" style={{ color: 'var(--foreground)' }}>
            {item.version}
          </span>
        </Field>
        {item.source != null && (
          <Field label="Source">
            <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              {item.source}
            </span>
          </Field>
        )}
        {item.category != null && (
          <Field label="Category">
            <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              {item.category}
            </span>
          </Field>
        )}
        {item.importance != null && (
          <Field label="Importance">
            <span className="mono text-sm" style={{ color: 'var(--foreground)' }}>
              {item.importance}
            </span>
          </Field>
        )}
      </div>

      {item.tags != null && item.tags.length > 0 && (
        <Field label="Tags">
          <div className="flex flex-wrap gap-1.5">
            {item.tags.map((tag) => (
              <span
                key={tag}
                className="mono rounded px-1.5 py-0.5 text-xs"
                style={{
                  color: 'var(--muted-foreground)',
                  background: 'var(--card)',
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        </Field>
      )}

      <Field label="Content">
        {/* Untrusted memory content rendered as a TEXT node (React escaping is
            the XSS boundary — never the raw-HTML escape hatch, T-02B-01). */}
        <p
          className="text-sm whitespace-pre-wrap"
          style={{ color: 'var(--foreground)', lineHeight: 1.5 }}
        >
          {item.content}
        </p>
      </Field>

      <Separator />

      {/* Phase-1 raw-JSON viewer — collapsed by default, JSON.stringify into a
          <pre> text node (never raw HTML). */}
      <RawJsonViewer data={item} label="Raw JSON" />

      <Separator />

      {/* Action region: the Patch editor (02-04) + the full lifecycle set
          (pin/unpin/disable/enable/delete + the two confirm weights, 02-05). */}
      <DrawerActionRegion item={item} />
    </div>
  )
}

/**
 * Drawer action region. The Patch action (02-04, D-07/D-08) opens the
 * EditorDrawer in PATCH mode pre-filled with this item's patchable fields. The
 * lifecycle set (02-05) is the shared `LifecycleActions` in `drawer` variant:
 * pin/unpin/disable/enable/delete with the two confirm weights + pessimistic
 * in-flight. A successful delete clears `?item` (D-05) so the drawer closes.
 */
function DrawerActionRegion({ item }: { item: MemoryItem }) {
  const { setItem } = useMemorySearchParams()
  const [patchOpen, setPatchOpen] = useState(false)

  return (
    <div className="flex flex-wrap gap-2" aria-label="Lifecycle actions">
      {/* Patch editor → EditorDrawer (patch mode), pre-filled patchable fields. */}
      <Button onClick={() => setPatchOpen(true)}>Patch</Button>

      {/* Lifecycle set (D-06 drawer / D-10 confirms / D-11 pessimistic). Delete
          clears ?item on success so the drawer closes (D-05). */}
      <LifecycleActions
        item={item}
        variant="drawer"
        onDeleted={() => setItem(undefined)}
      />

      {/* Keyed on open so it remounts pre-filled from the current item each time. */}
      {patchOpen && (
        <EditorDrawer
          key={`patch-${item.memory_id}-${item.version}`}
          mode="patch"
          item={item}
          open={patchOpen}
          onOpenChange={setPatchOpen}
        />
      )}
    </div>
  )
}
