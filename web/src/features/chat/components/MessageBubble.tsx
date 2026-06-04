import type { ReactNode } from 'react'

import { Label } from '@/components/ui/label'

/**
 * A single chat bubble (S2/S3 — D-01 bubble treatment).
 *
 * Per the 04-UI-SPEC Color note: BOTH user and assistant bubbles are
 * left-aligned, full-width-of-column, on the SAME Secondary surface (#151A23 via
 * `var(--card)`), distinguished only by an uppercase mono `USER`/`ASSISTANT`
 * caption + a 2px left rail — neutral `var(--border)` for user, accent
 * `var(--primary)` for the assistant (the stateful turn). md (16px) internal
 * padding (prose comfort).
 *
 * `children` is rendered as React children → TEXT nodes. The page passes the
 * message/answer strings as children; there is NO dangerouslySetInnerHTML
 * anywhere (T-04-04 / D-01 XSS posture — React escapes by default).
 */
export interface MessageBubbleProps {
  role: 'user' | 'assistant'
  children: ReactNode
}

export function MessageBubble({ role, children }: MessageBubbleProps) {
  const railColor = role === 'assistant' ? 'var(--primary)' : 'var(--border)'
  const caption = role === 'assistant' ? 'ASSISTANT' : 'USER'

  return (
    <div
      data-role={role}
      className="flex flex-col gap-2 rounded-md p-4"
      style={{
        background: 'var(--card)',
        borderLeft: `2px solid ${railColor}`,
      }}
    >
      <Label
        className="mono text-xs uppercase tracking-wide"
        style={{ color: 'var(--muted-foreground)' }}
      >
        {caption}
      </Label>
      <div className="text-sm" style={{ color: 'var(--foreground)' }}>
        {children}
      </div>
    </div>
  )
}
