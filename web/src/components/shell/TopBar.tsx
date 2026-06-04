import { useQuery } from '@tanstack/react-query'
import { HealthDot } from '@/components/shell/HealthDot'
import { OperatorContextBar } from '@/components/shell/OperatorContextBar'

/**
 * Always-visible top bar. Left: app name. Center: the active environment /
 * endpoint indicator (read-only in v1, SHELL-04) read from /api/config/env and
 * rendered in monospace — an operator must never be unsure which environment
 * they act against. Right: per-service health dots (unknown in Phase 1) and the
 * operator-context bar.
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

export function TopBar() {
  return (
    <header
      className="flex h-12 shrink-0 items-center gap-4 border-b px-4"
      style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
    >
      <span className="text-[14px] font-semibold">llm-agent-console</span>
      <EnvIndicator />
      <div className="ml-auto flex items-center gap-3">
        <HealthDot service="memory" status="unknown" />
        <HealthDot service="flow" status="unknown" />
        <HealthDot service="chat" status="unknown" />
        <OperatorContextBar />
      </div>
    </header>
  )
}
