/**
 * DeleteFlowDialog — the red destructive delete-confirm (IC-1). Task 3 fills
 * this with the Phase-1 red dialog (204 = success → toast + route to /flows).
 * This Task-2 placeholder only satisfies the FlowDetailPage import so the
 * Definition tab header renders; it carries the flowId it will delete.
 */
export function DeleteFlowDialog({ flowId }: { flowId: string }) {
  return <span data-flow-id={flowId} hidden aria-hidden />
}
