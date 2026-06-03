/**
 * Per-service health dot. Phase 1 ships the visual contract + `unknown` initial
 * state only; live polling lands in Phase 5 (SHELL-02). 8px dot + status color +
 * service label so status never relies on color alone.
 */
export type HealthStatus = 'up' | 'degraded' | 'down' | 'unknown'

export type HealthService = 'memory' | 'flow' | 'chat'

const SERVICE_LABEL: Record<HealthService, string> = {
  memory: 'memory-gateway',
  flow: 'flowd',
  chat: 'chat',
}

const STATUS_VAR: Record<HealthStatus, string> = {
  up: 'var(--status-up)',
  degraded: 'var(--status-degraded)',
  down: 'var(--status-down)',
  unknown: 'var(--status-unknown)',
}

export function HealthDot({
  service,
  status = 'unknown',
}: {
  service: HealthService
  status?: HealthStatus
}) {
  return (
    <span className="flex items-center gap-1.5" title={`${SERVICE_LABEL[service]}: ${status}`}>
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: STATUS_VAR[status] }}
      />
      <span
        className="text-[12px] font-semibold uppercase tracking-[0.04em]"
        style={{ color: 'var(--muted-foreground)', letterSpacing: '0.04em' }}
      >
        {SERVICE_LABEL[service]}
      </span>
    </span>
  )
}
