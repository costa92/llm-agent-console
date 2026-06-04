import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

import { RunDetail } from './components/RunDetail'

/**
 * The run sub-route page (S8 / D-08): `/flows/{flowId}/runs/{runId}` — the
 * SINGLE render location for BOTH live runs and replays. The route component
 * (routes/flow.tsx) reads `$flowId`/`$runId` and renders this page.
 *
 * Layout: a back-link to the flow detail (browser-back also returns there, since
 * the sub-route path nests under `/flows/{flowId}`) + a header + the RunDetail
 * body (the run summary + the SAME TimelineView mounting both live and replay).
 *
 * The heavy lifting (status branch → live vs replay/instant-fill, empty-events,
 * D-09) lives in RunDetail; this page is the route shell.
 */
export interface RunDetailPageProps {
  flowId: string
  runId: string
}

export function RunDetailPage({ flowId, runId }: RunDetailPageProps) {
  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <Link
          to="/flows/$flowId"
          params={{ flowId }}
          className="inline-flex w-fit items-center gap-1 text-sm"
          style={{ color: 'var(--muted-foreground)' }}
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {/* flowId is a flowd identifier → TEXT node (T-03-V5). */}
          Back to {flowId}
        </Link>
        <h1
          className="text-[20px] font-semibold"
          style={{ color: 'var(--foreground)' }}
        >
          Run
        </h1>
      </header>

      <RunDetail flowId={flowId} runId={runId} />
    </div>
  )
}
