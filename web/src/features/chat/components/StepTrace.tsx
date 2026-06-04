import { useState } from 'react'
import {
  Brain,
  Circle,
  Eye,
  Flag,
  ListChecks,
  Loader,
  RotateCcw,
  Wrench,
} from 'lucide-react'

import { RawJsonViewer } from '@/components/primitives/RawJsonViewer'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import type { AssistantTurn, StepRow } from '@/features/chat/turns/reducer'

/**
 * The chat-specific collapsible inline step trace (04-UI-SPEC IC-2 — THE
 * KEYSTONE renderer, D-01 / CHAT-01). It MIRRORS the Phase-3 `TimelineView`
 * frame-row PATTERN (gutter icon + label + collapsed RawJsonViewer + 1px rail +
 * live-tail spin) but over chat `{kind,text}` step rows — it does NOT reuse the
 * flow `TimelineView`/`FrameRow` (those are flow-schema-bound).
 *
 * Color (04-UI-SPEC table (a)): every step kind is NEUTRAL slate
 * (`--status-unknown`) — agent steps are trace breadcrumbs, not statuses; only
 * the terminal `done`/`error` carry green/red and those are handled by the PAGE
 * (they are separate SSE events, not step rows). The `kind` is an OPEN string —
 * an unknown kind falls back to a neutral `circle` icon and never crashes.
 *
 * Live → collapse-on-done (D-01): while `status==='streaming'` the trace is
 * EXPANDED, the summary reads "Streaming steps…", and the LAST (live tail) row's
 * gutter icon `loader`-spins. Once settled (`done`/`error`/`stopped`) the trace
 * DEFAULTS COLLAPSED to a clickable "{N} steps" summary (re-expandable via the
 * shadcn collapsible). Empty steps render nothing (the page owns the
 * sync-no-trace + "Thinking…" placeholder cases).
 *
 * All step text + labels render as TEXT nodes; the per-step raw frame goes
 * through `RawJsonViewer` (also text) — no dangerouslySetInnerHTML (T-04-07).
 */

/** Step-kind → lucide icon (04-UI-SPEC table (a)); unknown → `circle` fallback. */
const KIND_ICON: Record<string, typeof Circle> = {
  thought: Brain,
  plan: ListChecks,
  action: Wrench,
  observation: Eye,
  reflection: RotateCcw,
  final: Flag,
}

export interface StepTraceProps {
  /** The active assistant turn's step rows ({kind,text}). */
  steps: StepRow[]
  /** The turn status — drives expanded-while-streaming vs collapsed-on-settle. */
  status: AssistantTurn['status']
}

export function StepTrace({ steps, status }: StepTraceProps) {
  const streaming = status === 'streaming'
  // The operator's manual collapse/expand once the turn has SETTLED. While
  // streaming the trace is always expanded (D-01); once settled it defaults
  // collapsed but the operator can re-expand. `null` = follow the default.
  const [settledOpen, setSettledOpen] = useState<boolean | null>(null)
  // Expanded while streaming; once settled, honour the operator override (else
  // the collapsed default). Streaming always wins — no setState-in-effect needed.
  const open = streaming ? true : (settledOpen ?? false)

  // Empty trace → render nothing (sync turn / pre-first-frame turn).
  if (steps.length === 0) return null

  const summary = streaming ? 'Streaming steps…' : `${steps.length} steps`

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        // Operator toggles only take effect once settled; streaming stays open.
        if (!streaming) setSettledOpen(next)
      }}
      data-slot="step-trace"
    >
      <CollapsibleTrigger
        className="text-xs uppercase tracking-wide"
        style={{ color: 'var(--muted-foreground)' }}
      >
        {open ? 'Steps' : summary}
        {streaming && <span className="sr-only"> {summary}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="relative mt-2 flex flex-col gap-2">
          {/* 1px neutral gutter rail (mirror the Phase-3 timeline). */}
          <span
            aria-hidden
            className="absolute top-2 bottom-2 left-[11px] w-px"
            style={{ background: 'var(--border)' }}
          />
          {steps.map((step, i) => (
            <StepRowView
              key={i}
              step={step}
              spin={streaming && i === steps.length - 1}
            />
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}

function StepRowView({ step, spin }: { step: StepRow; spin: boolean }) {
  const Icon = KIND_ICON[step.kind] ?? Circle
  return (
    <li className="relative flex gap-3 py-1 pl-0">
      {/* Gutter step-kind icon — ALL neutral slate (table (a)); live tail spins. */}
      <span
        className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full"
        style={{ background: 'var(--card)' }}
      >
        {spin ? (
          <Loader
            className="size-4 animate-spin"
            style={{ color: 'var(--status-unknown)' }}
            aria-hidden
          />
        ) : (
          <Icon
            className="size-4"
            style={{ color: 'var(--status-unknown)' }}
            aria-hidden
          />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 pb-1">
        {/* Step-kind label (sans Body) — a TEXT node. */}
        <span
          className="mono text-xs uppercase tracking-wide"
          style={{ color: 'var(--muted-foreground)' }}
        >
          {step.kind}
        </span>
        {/* The step text (sans Body) — a TEXT node (no dangerouslySetInnerHTML). */}
        <span className="text-sm" style={{ color: 'var(--foreground)' }}>
          {step.text}
        </span>
        {/* Collapsed per-step raw frame. */}
        <RawJsonViewer data={{ kind: step.kind, answer: step.text }} label="Frame" />
      </div>
    </li>
  )
}
