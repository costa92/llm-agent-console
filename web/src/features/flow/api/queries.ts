import { useQuery } from '@tanstack/react-query'
import {
  listFlows,
  getFlow,
  listRuns,
  getRun,
  listRunEvents,
} from './client'

/**
 * TanStack Query key factory + REST read hooks for the flow feature.
 *
 * Only the REST reads live here — the SSE streamed-run + replay paths are driven
 * IMPERATIVELY (stream.ts), NOT through the Query cache (PROJECT.md SSE
 * decision). Mutations (create/PUT/delete) + the runs-list invalidation after a
 * run land in the CRUD/run slices (03-02 / 03-03) that consume these keys.
 */
export const flowKeys = {
  flows: () => ['flows'] as const,
  flow: (id: string) => ['flow', id] as const,
  runs: (flowId: string) => ['flow-runs', flowId] as const,
  run: (id: string) => ['run', id] as const,
  runEvents: (id: string) => ['run-events', id] as const,
}

/** GET /api/flow/flows — the flows list. */
export function useFlowsQuery() {
  return useQuery({
    queryKey: flowKeys.flows(),
    queryFn: () => listFlows(),
  })
}

/** GET /api/flow/flows/{id} — a flow record (base64-decoded). Enabled when id set. */
export function useFlowQuery(id: string | undefined) {
  return useQuery({
    queryKey: flowKeys.flow(id ?? ''),
    queryFn: () => getFlow(id as string),
    enabled: !!id,
  })
}

/** GET /api/flow/flows/{id}/runs — the run history. Enabled when flowId set. */
export function useRunsQuery(flowId: string | undefined) {
  return useQuery({
    queryKey: flowKeys.runs(flowId ?? ''),
    queryFn: () => listRuns(flowId as string),
    enabled: !!flowId,
  })
}

/** GET /api/flow/runs/{id} — a run record. Enabled when id set. */
export function useRunQuery(id: string | undefined) {
  return useQuery({
    queryKey: flowKeys.run(id ?? ''),
    queryFn: () => getRun(id as string),
    enabled: !!id,
  })
}

/** GET /api/flow/runs/{id}/events — a completed run's events. Enabled when id set. */
export function useRunEventsQuery(id: string | undefined) {
  return useQuery({
    queryKey: flowKeys.runEvents(id ?? ''),
    queryFn: () => listRunEvents(id as string),
    enabled: !!id,
  })
}
