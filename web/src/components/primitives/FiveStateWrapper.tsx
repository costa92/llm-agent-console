import * as React from 'react'
import { AlertCircle, AlertTriangle, Inbox, Loader } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The five-state contract (01-UI-SPEC.md). Every list/detail/stream view in
 * Phases 2-5 renders exactly ONE of these states — a blank panel is a contract
 * violation. The state machine is intentionally precedence-ordered and designed
 * to EXTEND: Phase 5 layers SSE disconnected/reconnecting states on top without
 * rewriting this primitive.
 */
export interface UpstreamError {
  /** Upstream HTTP status (BFF-04 pass-through). Omitted for transport errors. */
  status?: number
  /** The backend the error came from, e.g. "memory-gateway". */
  service?: string
  /** The verbatim upstream message — never collapsed into a generic string. */
  message: string
}

export interface FiveStateProps {
  /** Request in flight, no data yet. */
  loading: boolean
  /** Request failed (upstream non-2xx or transport error). */
  error?: UpstreamError | null
  /** Request succeeded, zero items. */
  empty?: boolean
  /** Some data loaded, some failed/degraded — banner renders ABOVE children. */
  partial?: { message: string } | null
  /** The ready-state content. */
  children: React.ReactNode
  /** Optional Retry handler for the error state (consumer concern). */
  onRetry?: () => void
  /** Optional "Set context" handler for the empty state (consumer concern). */
  onSetContext?: () => void
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <Loader
        className="size-4 animate-spin"
        style={{ color: 'var(--status-unknown)' }}
        aria-hidden
      />
      <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
        Loading…
      </p>
    </div>
  )
}

function ErrorState({ status, service, message, onRetry }: UpstreamError & { onRetry?: () => void }) {
  // Build the exact UI-SPEC error copy via template literals (status, service,
  // message interpolated). Status is omitted when undefined; the "from <service>"
  // segment is dropped entirely when service is undefined.
  const prefix = [status, service ? `from ${service}` : undefined]
    .filter(Boolean)
    .join(' ')
  const headline = prefix ? `${prefix} — ${message}.` : `${message}.`

  return (
    <div className="flex flex-col items-start gap-3 py-12">
      <div className="flex items-center gap-2">
        <AlertCircle
          className="size-4 shrink-0"
          style={{ color: 'var(--status-down)' }}
          aria-hidden
        />
        <p className="text-sm" style={{ color: 'var(--foreground)' }}>
          {headline}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRetry}
          style={{ color: 'var(--muted-foreground)' }}
        >
          Retry
        </Button>
        <Collapsible>
          <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
            <ChevronRight className="size-3.5 group-data-[state=open]:hidden" aria-hidden />
            <ChevronDown className="hidden size-3.5 group-data-[state=open]:inline" aria-hidden />
            View raw JSON
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre
              className="mono mt-1 overflow-auto rounded-md p-2 text-xs"
              style={{
                background: 'var(--card)',
                color: 'var(--muted-foreground)',
              }}
            >
              {JSON.stringify({ status, service, message }, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  )
}

function EmptyState({ onSetContext }: { onSetContext?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Inbox
        className="size-4"
        style={{ color: 'var(--muted-foreground)' }}
        aria-hidden
      />
      <h3 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
        No operator context set
      </h3>
      <p className="max-w-md text-sm" style={{ color: 'var(--muted-foreground)' }}>
        Set a tenant id and user id to reach the backends. Project and session are
        optional.
      </p>
      <Button onClick={onSetContext}>Set context</Button>
    </div>
  )
}

function PartialBanner({ message }: { message: string }) {
  return (
    <div
      className="mb-3 flex items-center gap-2 rounded-md border px-3 py-2"
      style={{
        borderColor: 'var(--status-degraded)',
        background: 'color-mix(in oklch, var(--status-degraded) 12%, transparent)',
      }}
    >
      <AlertTriangle
        className="size-4 shrink-0"
        style={{ color: 'var(--status-degraded)' }}
        aria-hidden
      />
      <p className="text-sm" style={{ color: 'var(--foreground)' }}>
        Showing partial data — {message}.
      </p>
    </div>
  )
}

export function FiveStateWrapper({
  loading,
  error,
  empty,
  partial,
  children,
  onRetry,
  onSetContext,
}: FiveStateProps) {
  if (loading) return <LoadingState />
  if (error) return <ErrorState {...error} onRetry={onRetry} />
  if (empty) return <EmptyState onSetContext={onSetContext} />
  return (
    <div className={cn('contents')}>
      {partial && <PartialBanner message={partial.message} />}
      {children}
    </div>
  )
}
