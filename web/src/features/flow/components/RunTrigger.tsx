import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FlowdError } from '@/features/flow/api/client'
import { useRunStream } from '@/features/flow/timeline/useRunStream'
import { useSyncRun } from '@/features/flow/hooks/useSyncRun'
import { RunResultPanel } from './RunResultPanel'

/**
 * The run trigger (S4 / IC-4 / D-04 / D-08). An Inputs key/value form
 * (string→string — flowd `runRequest.Inputs map[string]string`) plus two
 * actions, ONE result surface:
 *
 *   - PRIMARY "Run" (accent) → `useRunStream.start(flowId, inputs, { onRunId })`.
 *     On `X-Run-ID` (onRunId) it NAVIGATES to `/flows/{flowId}/runs/{runId}` —
 *     the single live+replay render location where the live TimelineView mounts
 *     (Plan 05). The Definition tab itself does NOT mount the live timeline (D-08).
 *   - SECONDARY "Run (sync)" (neutral) → `useSyncRun` (blocking POST /run). Its
 *     {outputs} render into the shared RunResultPanel; a failure renders the
 *     {error} there (red) + an error toast. Pessimistic: both buttons disable +
 *     the panel spins while a sync run is in flight.
 *
 * All flowd strings render as TEXT nodes (T-03-V5). The X-Run-ID only builds a
 * local route param — never markup, never a fetch auth header (T-03-12).
 */

export interface RunTriggerProps {
  flowId: string
}

type InputRow = { key: string; value: string }

export function RunTrigger({ flowId }: RunTriggerProps) {
  const navigate = useNavigate()
  const stream = useRunStream()
  const sync = useSyncRun(flowId)
  const [rows, setRows] = useState<InputRow[]>([{ key: '', value: '' }])

  const running = sync.isPending

  /** Collapse the rows into a string→string map (last write wins on dup keys). */
  function collectInputs(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const r of rows) {
      const k = r.key.trim()
      if (k) out[k] = r.value
    }
    return out
  }

  function setRow(i: number, patch: Partial<InputRow>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  function addRow() {
    setRows((prev) => [...prev, { key: '', value: '' }])
  }
  function removeRow(i: number) {
    setRows((prev) =>
      prev.length === 1 ? [{ key: '', value: '' }] : prev.filter((_, j) => j !== i),
    )
  }

  function handleRunStreamed() {
    stream.start(flowId, collectInputs(), {
      onRunId: (runId) => {
        // D-08: navigate to the deep-linkable run sub-route as soon as flowd
        // assigns the run id (X-Run-ID). The live TimelineView mounts there
        // (Plan 05). The run id is a route PARAM only — encoded into the local
        // path, never markup or an auth header (T-03-12).
        //
        // The `/flows/{id}/runs/{runId}` route is REGISTERED in Plan 05; until
        // then it is not in the typed route tree, so we navigate to the built
        // path string. The cast is the single seam where this plan reaches a
        // route Plan 05 owns; it is removed once that route exists.
        const to = `/flows/${encodeURIComponent(flowId)}/runs/${encodeURIComponent(runId)}`
        void navigate({ to } as Parameters<typeof navigate>[0])
      },
    })
  }

  function handleRunSync() {
    sync.mutate(collectInputs())
  }

  // The sync result feeds the ONE result surface (D-04).
  const syncError =
    sync.error instanceof FlowdError
      ? sync.error.message
      : sync.error instanceof Error
        ? sync.error.message
        : undefined

  return (
    <section
      aria-label="Run trigger"
      className="flex flex-col gap-4 rounded-md border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
    >
      <fieldset className="flex flex-col gap-3" disabled={running}>
        <Label className="text-sm" style={{ color: 'var(--foreground)' }}>
          Inputs
        </Label>
        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                aria-label={`Input key ${i + 1}`}
                placeholder="key"
                className="mono"
                value={row.key}
                onChange={(e) => setRow(i, { key: e.target.value })}
              />
              <Input
                aria-label={`Input value ${i + 1}`}
                placeholder="value"
                className="mono"
                value={row.value}
                onChange={(e) => setRow(i, { value: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove input ${i + 1}`}
                onClick={() => removeRow(i)}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit gap-1"
            onClick={addRow}
          >
            <Plus className="size-3.5" aria-hidden />
            Add input
          </Button>
        </div>
      </fieldset>

      <div className="flex items-center gap-2">
        {/* PRIMARY — streamed run → navigates to the run sub-route on X-Run-ID. */}
        <Button type="button" onClick={handleRunStreamed} disabled={running}>
          Run
        </Button>
        {/* SECONDARY — sync run → ONE result surface. */}
        <Button
          type="button"
          variant="outline"
          onClick={handleRunSync}
          disabled={running}
        >
          Run (sync)
        </Button>
      </div>

      {/* The ONE result surface (D-04) — sync outputs / error / in-flight loader. */}
      <RunResultPanel
        loading={running}
        outputs={sync.data?.outputs}
        error={syncError}
      />
    </section>
  )
}
