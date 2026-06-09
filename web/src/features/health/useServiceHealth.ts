/**
 * useServiceHealth — TanStack Query poll of /api/health (SHELL-02 / D-01 / D-02).
 *
 * Polls the BFF aggregate health endpoint every ~15s (D-02). Returns per-service
 * status + lastChecked, applying the stale-on-self-failure rule (D-02):
 *   - isPending (pre-first-poll)  → status 'unknown', lastChecked undefined
 *   - isError (poll itself failed) → status 'unknown', lastChecked from last success
 *   - success → real status from the DTO
 *
 * 'unknown' is a CLIENT-side state; the BFF never emits it — it only returns
 * up | down | degraded (D-02).
 */
import { useQuery } from '@tanstack/react-query'
import type { HealthStatus } from '@/components/shell/HealthDot'

/** DTO returned by the BFF GET /api/health endpoint (D-01). */
export type HealthDTO = {
  services: Record<
    'memory' | 'flow' | 'chat',
    {
      status: 'up' | 'down' | 'degraded'
      lastChecked: string
      latencyMs?: number
    }
  >
}

/** Per-service derived state exposed to the caller. */
export type ServiceHealthState = {
  status: HealthStatus
  lastChecked?: string
  latencyMs?: number
}

async function fetchHealth(): Promise<HealthDTO> {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error(`${res.status}`)
  return (await res.json()) as HealthDTO
}

/**
 * Polls /api/health and returns the raw TanStack Query result plus a
 * convenience `getService` helper that applies the stale-on-self-failure rule.
 */
export function useServiceHealth() {
  const q = useQuery({
    queryKey: ['service-health'],
    queryFn: fetchHealth,
    refetchInterval: 15_000, // D-02 ~15s cadence
    refetchIntervalInBackground: false, // pause when tab hidden (discretion D-02)
    refetchOnWindowFocus: true, // refresh on tab focus
  })

  /**
   * Returns the status + last-checked for a single service.
   *
   * Stale-on-self-failure (D-02): when the /api/health poll itself errors, we
   * force status='unknown' but keep the lastChecked from the last successful
   * q.data so the operator sees "Checked N ago — health check unavailable"
   * rather than a blank dot.
   */
  function getService(svc: 'memory' | 'flow' | 'chat'): ServiceHealthState {
    if (q.isPending) {
      return { status: 'unknown' }
    }
    if (q.isError) {
      // Keep stale lastChecked from the last successful response if available.
      const staleChecked = q.data?.services?.[svc]?.lastChecked
      return { status: 'unknown', lastChecked: staleChecked }
    }
    const s = q.data.services[svc]
    return {
      status: s.status,
      lastChecked: s.lastChecked,
      latencyMs: s.latencyMs,
    }
  }

  return { q, getService }
}
