import { CircleSlash, Pin } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

/**
 * Lifecycle status badges (D-13). Each pairs color + icon + text so the state is
 * NEVER conveyed by color alone (color-blind safe per UI-SPEC). Absence of a
 * badge = normal — there is deliberately NO "active"/"live" badge (badge spam
 * forbidden).
 */

/** Amber "operator-flagged / attention" — NOT an error. (--status-degraded) */
export function PinnedBadge() {
  return (
    <Badge
      variant="outline"
      style={{
        color: 'var(--status-degraded)',
        borderColor: 'var(--status-degraded)',
        background: 'color-mix(in oklch, var(--status-degraded) 12%, transparent)',
      }}
    >
      <Pin className="size-3.5" aria-hidden />
      PINNED
    </Badge>
  )
}

/** Muted "inert / excluded from recall". (--status-unknown) */
export function DisabledBadge() {
  return (
    <Badge
      variant="outline"
      style={{
        color: 'var(--status-unknown)',
        borderColor: 'var(--status-unknown)',
      }}
    >
      <CircleSlash className="size-3.5" aria-hidden />
      DISABLED
    </Badge>
  )
}
