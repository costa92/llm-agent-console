import * as React from 'react'
import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

export interface RawJsonViewerProps {
  /** Any JSON-serializable payload — memory item, run event, chat step, error body. */
  data: unknown
  /** Disclosure label; defaults to "Raw JSON". */
  label?: string
}

/**
 * Collapsible raw-JSON viewer (01-UI-SPEC cross-cutting primitive). Collapsed by
 * default in detail/error contexts; copy-to-clipboard button copies the full
 * payload and toasts "Copied". Plain mono <pre> for Phase 1 — syntax colorization
 * is a deferred follow-up (no rainbow), per RESEARCH.md. One component reused for
 * memory items, run events, chat steps and error bodies.
 */
export function RawJsonViewer({ data, label = 'Raw JSON' }: RawJsonViewerProps) {
  const [open, setOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const pretty = JSON.stringify(data, null, 2)

  function handleCopy() {
    void navigator.clipboard.writeText(pretty)
    toast.success('Copied')
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-1">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 px-1 text-xs"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {open ? (
              <ChevronDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden />
            )}
            {label}
          </Button>
        </CollapsibleTrigger>
        {/* Copy button is always visible (not gated on expansion); min 32px hit target. */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Copy JSON"
          className="size-8 p-1"
          onClick={handleCopy}
          style={{ color: 'var(--muted-foreground)' }}
        >
          {copied ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <Copy className="size-4" aria-hidden />
          )}
        </Button>
      </div>
      <CollapsibleContent>
        <pre
          className="mono mt-1 overflow-auto rounded-md p-2 text-xs"
          style={{ background: 'var(--card)', color: 'var(--muted-foreground)' }}
        >
          {pretty}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}
