import { CopyableId } from '@/components/primitives/CopyableId'
import { FiveStateWrapper } from '@/components/primitives/FiveStateWrapper'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useFlowQuery } from '@/features/flow/api/queries'
import { FlowdError } from '@/features/flow/api/client'
import { FlowEditor } from './components/FlowEditor'
import { DeleteFlowDialog } from './components/DeleteFlowDialog'
import { RunTrigger } from './components/RunTrigger'

export type FlowDetailPageProps =
  | { mode: 'create' }
  | { mode: 'edit'; flowId: string }

/**
 * Flow detail route (S2 / IC-1). A FULL ROUTE with shadcn Tabs:
 *   - Definition → the route-hosted FlowEditor + the delete control + a
 *     run-trigger placeholder slot (Slice B / 03-04 fills the trigger).
 *   - Runs       → a run-history placeholder slot (Slice C / 03-05 fills it).
 *
 * Create mode (`/flows/new`) renders the editor blank/templated directly (no GET
 * — there is no flow yet); the Runs tab is hidden until the flow exists. Edit
 * mode wraps `useFlowQuery` in the Phase-1 five-state primitive (loading / error
 * / ready) and seeds the editor with the base64-DECODED flow IR.
 *
 * NB (D-08): the live TimelineView is NOT mounted here — it renders at the run
 * sub-route `/flows/{id}/runs/{runId}` (built in 03-04/03-05). This route only
 * leaves the run-trigger + run-history placeholder slots.
 */
export function FlowDetailPage(props: FlowDetailPageProps) {
  if (props.mode === 'create') {
    return (
      <div className="flex flex-col gap-6 p-6">
        <header>
          <h1
            className="text-[20px] font-semibold"
            style={{ color: 'var(--foreground)' }}
          >
            New flow
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Author the flow as JSON, then Save to create it.
          </p>
        </header>
        <FlowEditor mode="create" />
      </div>
    )
  }

  return <FlowDetailEdit flowId={props.flowId} />
}

function FlowDetailEdit({ flowId }: { flowId: string }) {
  const flowQuery = useFlowQuery(flowId)

  const err = flowQuery.error
  const errorState =
    err != null
      ? {
          status: err instanceof FlowdError ? err.status : undefined,
          service: 'flowd',
          message: err instanceof Error ? err.message : 'request failed',
        }
      : null

  const rec = flowQuery.data

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1
            className="text-[20px] font-semibold"
            style={{ color: 'var(--foreground)' }}
          >
            {/* name falls back to the id — TEXT node. */}
            {rec?.name ?? flowId}
          </h1>
          <CopyableId id={flowId} />
        </div>
      </header>

      <FiveStateWrapper
        loading={flowQuery.isLoading}
        error={errorState}
        onRetry={() => void flowQuery.refetch()}
      >
        {rec != null && (
          <Tabs defaultValue="definition" className="gap-4">
            <TabsList>
              <TabsTrigger value="definition">Definition</TabsTrigger>
              <TabsTrigger value="runs">Runs</TabsTrigger>
            </TabsList>

            <TabsContent value="definition" className="flex flex-col gap-6">
              {/* Definition-tab header action: the red destructive delete. */}
              <div className="flex items-center justify-end">
                <DeleteFlowDialog flowId={flowId} />
              </div>

              <FlowEditor
                mode="edit"
                flowId={flowId}
                flow={rec.flow}
                name={rec.name}
              />

              {/* Run trigger (Slice B / 03-04): the primary streamed "Run"
                  navigates to the run sub-route on X-Run-ID (D-08); the
                  secondary "Run (sync)" renders {outputs} into the shared
                  RunResultPanel (D-04). The live TimelineView is NOT mounted
                  here — it renders at the run sub-route (Plan 05). */}
              <RunTrigger flowId={flowId} />
            </TabsContent>

            <TabsContent value="runs">
              {/* Run-history placeholder slot — Slice C (03-05) fills it. */}
              <section
                aria-label="Run history"
                className="rounded-md border border-dashed p-6 text-center"
                style={{ borderColor: 'var(--border)' }}
              >
                <p
                  className="text-sm"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  Run history arrives in a later slice.
                </p>
              </section>
            </TabsContent>
          </Tabs>
        )}
      </FiveStateWrapper>
    </div>
  )
}
