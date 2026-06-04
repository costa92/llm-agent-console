export type FlowDetailPageProps =
  | { mode: 'create' }
  | { mode: 'edit'; flowId: string }

/**
 * Flow detail route (S2 / IC-1). Task 2 fills this with the Definition / Runs
 * tabs + the route-hosted editor. This Task-1 stub only satisfies the route
 * wiring so `/flows/{id}` and `/flows/new` resolve.
 */
export function FlowDetailPage(props: FlowDetailPageProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
        {props.mode === 'create'
          ? 'New flow editor — arrives in Task 2.'
          : `Flow ${props.flowId} — detail arrives in Task 2.`}
      </p>
    </div>
  )
}
