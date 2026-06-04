import { Loader } from 'lucide-react'

import { RawJsonViewer } from '@/components/primitives/RawJsonViewer'

/**
 * The ONE result surface (S4 / IC-4 / D-04). The sync run's `{outputs}` render
 * here via the raw-JSON viewer; a failed sync run renders its `{error}` (RED);
 * a loader spins while a run is in flight. This SAME component is the surface the
 * streamed run's terminal `flow_done` outputs render into at the run sub-route
 * (Plan 05) — a single outputs panel, never a second parallel surface.
 *
 * All flowd strings (outputs values, error) render as TEXT nodes (T-03-V5).
 */

export interface RunResultPanelProps {
  /** True while a sync run is in flight (loader spins, no result yet). */
  loading?: boolean
  /** The run outputs on success (string→string). */
  outputs?: Record<string, string>
  /** The verbatim flowd error string on failure (rendered RED). */
  error?: string
}

export function RunResultPanel({ loading, outputs, error }: RunResultPanelProps) {
  return (
    <section
      aria-label="Run result"
      className="flex flex-col gap-2 rounded-md border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
    >
      <h3
        className="text-base font-semibold"
        style={{ color: 'var(--foreground)' }}
      >
        Result
      </h3>

      {loading ? (
        <p
          className="flex items-center gap-2 text-sm"
          style={{ color: 'var(--muted-foreground)' }}
        >
          <Loader className="size-3.5 animate-spin" aria-hidden />
          Running…
        </p>
      ) : error != null ? (
        <p
          className="mono text-sm"
          style={{ color: 'var(--status-down)' }}
          data-slot="run-error"
        >
          {error}
        </p>
      ) : outputs != null ? (
        <div data-slot="run-outputs">
          <RawJsonViewer data={outputs} label="Outputs" />
        </div>
      ) : (
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Run this flow to see its result here.
        </p>
      )}
    </section>
  )
}
