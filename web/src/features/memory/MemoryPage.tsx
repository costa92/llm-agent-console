import { Inbox } from 'lucide-react'

import { useOperatorContext } from '@/app/OperatorContextProvider'
import { Button } from '@/components/ui/button'
import { FiveStateWrapper } from '@/components/primitives/FiveStateWrapper'
import { useRecallQuery } from '@/features/memory/api/queries'
import { SearchControls } from './components/SearchControls'
import { ResultsTable } from './components/ResultsTable'
import { ItemDrawer } from './components/ItemDrawer'
import { useMemorySearchParams } from './hooks/useMemorySearchParams'
import type { NormalizedGatewayError } from '@/features/memory/api/client'

/** Focus the operator-context bar's edit affordance (the D-12 "Set context" CTA). */
function focusOperatorContextBar() {
  const trigger = document.querySelector<HTMLElement>(
    '[aria-label="Edit operator context"]',
  )
  if (trigger) {
    trigger.scrollIntoView({ block: 'center' })
    trigger.focus()
    trigger.click()
  }
}

/**
 * Memory route page (S1+S2 / MEM-01 + MEM-08).
 *
 * D-12 / IC-7 gate FIRST: when tenant OR user is unset, the WHOLE route renders
 * the Phase-1 unset-context empty-state and RETURNS before any recall — no
 * useRecallQuery, no SearchControls, no doomed request. Only when both are set
 * does the recall + results surface render.
 */
export function MemoryPage() {
  const { tenantId, userId } = useOperatorContext()

  // ── D-12 / IC-7 context gate (BEFORE any recall) ──────────────────────────
  if (!tenantId || !userId) {
    return (
      <div className="flex h-full flex-col">
        <FiveStateWrapper
          loading={false}
          empty
          onSetContext={focusOperatorContextBar}
        >
          {null}
        </FiveStateWrapper>
      </div>
    )
  }

  return <MemoryConsole />
}

/**
 * The recall + results surface — rendered only once the context gate clears, so
 * useRecallQuery (which fires the request) is never mounted while unset.
 */
function MemoryConsole() {
  const { query, top_k } = useMemorySearchParams()

  // Recall is operator-initiated: useRecallQuery is enabled only on a non-empty
  // submitted query (02-01), so an empty query never fires a request.
  const recall = useRecallQuery({ query, top_k })

  const gatewayError = recall.error as NormalizedGatewayError | null | undefined
  const errorState =
    gatewayError != null
      ? {
          status: gatewayError.httpStatus,
          service: 'memory-gateway',
          message: gatewayError.error.message,
        }
      : null

  const hasQuery = query.trim().length > 0
  const hits = recall.data?.hits

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold" style={{ color: 'var(--foreground)' }}>
          Memory
        </h1>
        {/* Editor arrives in plan 02-04 — render the button as a disabled stub. */}
        <Button disabled title="Memory editor arrives in plan 02-04">
          New record
        </Button>
      </header>

      <SearchControls onRefresh={() => void recall.refetch()} />

      <section aria-label="Recall results">
        {!hasQuery ? (
          <p className="py-8 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Enter a query and hit Recall to search memory.
          </p>
        ) : (
          <FiveStateWrapper
            loading={recall.isLoading}
            error={errorState}
            onRetry={() => void recall.refetch()}
          >
            {hits != null && hits.length === 0 ? (
              <ZeroHits query={query} />
            ) : (
              hits != null && <ResultsTable hits={hits} topK={top_k} />
            )}
          </FiveStateWrapper>
        )}
      </section>

      {/* Item detail drawer (Slice B) — mounted once; opens over the list when
          ?item is set (its own ?item-synced open state). It overlays the results
          rather than replacing them (D-04 — drawer, not a full route). */}
      <ItemDrawer />
    </div>
  )
}

/**
 * Zero-hits empty-state — DISTINCT from the unset-context gate and from the
 * error state (Pitfall 5). Copy per UI-SPEC: "No memory matched."
 */
function ZeroHits({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Inbox className="size-4" style={{ color: 'var(--muted-foreground)' }} aria-hidden />
      <h3 className="text-[20px] font-semibold" style={{ color: 'var(--foreground)' }}>
        No memory matched.
      </h3>
      <p className="max-w-md text-sm" style={{ color: 'var(--muted-foreground)' }}>
        No items match &ldquo;{query}&rdquo; for this tenant/user. Try a broader
        query or raise top-k.
      </p>
    </div>
  )
}
