import { useQuery } from '@tanstack/react-query'
import { HealthDot } from '@/components/shell/HealthDot'
import { OperatorContextBar } from '@/components/shell/OperatorContextBar'
import { useServiceHealth } from '@/features/health/useServiceHealth'

/**
 * Always-visible top bar. Left: app name. Center: the active environment /
 * endpoint indicator (read-only in v1, SHELL-04) read from /api/config/env and
 * rendered in monospace — an operator must never be unsure which environment
 * they act against. Right: per-service health dots (live via useServiceHealth,
 * SHELL-02 / D-01 / D-02) and the operator-context bar.
 */
type EnvConfig = {
  env: string
  memory_base?: string
  flow_base?: string
  chat_base?: string
}

async function fetchEnv(): Promise<EnvConfig> {
  const res = await fetch('/api/config/env')
  if (!res.ok) {
    throw new Error(`${res.status}`)
  }
  return (await res.json()) as EnvConfig
}

function EnvIndicator() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['config-env'],
    queryFn: fetchEnv,
  })

  if (isLoading) {
    return (
      <span className="mono text-[14px]" style={{ color: 'var(--status-unknown)' }}>
        Loading…
      </span>
    )
  }
  if (isError || !data) {
    return (
      <span className="mono text-[14px]" style={{ color: 'var(--status-down)' }}>
        env unavailable
      </span>
    )
  }
  return (
    <span className="flex items-baseline gap-2">
      <span
        className="text-[12px] font-semibold uppercase tracking-[0.04em]"
        style={{ color: 'var(--muted-foreground)', letterSpacing: '0.04em' }}
      >
        ENV
      </span>
      <span className="mono text-[14px]" style={{ color: 'var(--foreground)' }}>
        {data.env}
      </span>
      {data.memory_base && (
        <span
          className="mono text-[14px]"
          style={{ color: 'var(--muted-foreground)' }}
        >
          {data.memory_base}
        </span>
      )}
    </span>
  )
}

/**
 * Formats a last-checked ISO timestamp into a relative string for the dot tooltip.
 * Returns "Checking…" when no timestamp is available (pre-first-poll).
 * Appends "— health check unavailable" when the poll itself failed (isError).
 */
function formatLastChecked(lastChecked?: string, isError?: boolean): string {
  if (!lastChecked) return 'Checking…'
  const diffMs = Date.now() - new Date(lastChecked).getTime()
  const diffS = Math.round(diffMs / 1000)
  const timeStr =
    diffS < 60
      ? `${diffS}s ago`
      : diffS < 3600
        ? `${Math.round(diffS / 60)}m ago`
        : `${Math.round(diffS / 3600)}h ago`
  const checked = `Checked ${timeStr}`
  return isError ? `${checked} — health check unavailable` : checked
}

/**
 * LiveHealthDots renders the three service health dots driven by the polling
 * hook useServiceHealth (SHELL-02). Each dot title shows the last-checked
 * timestamp; on stale/error it appends "— health check unavailable" so the
 * operator can distinguish a stale dot from a blank one (D-02 requirement).
 */
function LiveHealthDots() {
  const { getService, q } = useServiceHealth()

  const memory = getService('memory')
  const flow = getService('flow')
  const chat = getService('chat')

  const isStale = q.isError

  return (
    <>
      <span title={formatLastChecked(memory.lastChecked, isStale)}>
        <HealthDot service="memory" status={memory.status} />
      </span>
      <span title={formatLastChecked(flow.lastChecked, isStale)}>
        <HealthDot service="flow" status={flow.status} />
      </span>
      <span title={formatLastChecked(chat.lastChecked, isStale)}>
        <HealthDot service="chat" status={chat.status} />
      </span>
    </>
  )
}

export function TopBar() {
  return (
    <header
      className="flex h-12 shrink-0 items-center gap-4 border-b px-4"
      style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
    >
      <span className="text-[14px] font-semibold">llm-agent-console</span>
      <EnvIndicator />
      <div className="ml-auto flex items-center gap-3">
        <LiveHealthDots />
        <OperatorContextBar />
      </div>
    </header>
  )
}
