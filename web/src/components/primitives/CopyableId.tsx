import * as React from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface CopyableIdProps {
  /** The resource id (tenant/user/run/session/memory) to render and copy. */
  id: string
  /** Optional extra classes on the outer wrapper. */
  className?: string
}

/**
 * Copyable id (01-UI-SPEC cross-cutting primitive). Renders any resource id in
 * mono (14px Body); a hover-revealed copy icon (lucide `copy`) flips to `check`
 * for ~1s on click, toasts "Copied", and writes the id to the clipboard. The
 * icon button carries a min 32px hit target.
 */
export function CopyableId({ id, className }: CopyableIdProps) {
  const [copied, setCopied] = React.useState(false)

  function handleCopy() {
    void navigator.clipboard.writeText(id)
    toast.success('Copied')
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  return (
    <span className={cn('group inline-flex items-center gap-1', className)}>
      <span className="mono text-sm" style={{ color: 'var(--foreground)' }}>
        {id}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Copy id"
        onClick={handleCopy}
        className="size-8 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        style={{ color: copied ? 'var(--status-up)' : 'var(--primary)' }}
      >
        {copied ? (
          <Check className="size-4" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
      </Button>
    </span>
  )
}
