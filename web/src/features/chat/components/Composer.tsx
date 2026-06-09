import type { KeyboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

/**
 * The chat composer (S4 / IC-4 / D-04 — stream + sync).
 *
 * A multi-line `textarea` (placeholder "Message the agent…") + a primary "Send"
 * button. Enter sends (preventDefault + onSend when the value is non-empty),
 * Shift+Enter inserts a newline. Send is disabled when the value is
 * empty/whitespace-only OR `disabled` (in-flight).
 *
 * 04-03 fills the toolbar seam (D-03/D-04):
 * - A `Stream | Sync` 2-segment toggle (a `button` group — NO new shadcn
 *   `switch` block, per RESEARCH Rec 3). Default "Stream" (the streamed Send
 *   path). The page owns `mode` state; this fires `onModeChange`. The Sync
 *   segment carries the tooltip "One-shot reply, no live steps." (native title).
 * - A neutral `Stop` button shown IN PLACE OF Send while `streaming`, wired to
 *   `onStop` (the D-04 abort). Stop is NOT destructive-red, NOT accent.
 *
 * While `streaming`, the textarea, Send, and the mode toggle are disabled (no
 * concurrent turns / no mid-stream mode switch); only Stop is active.
 *
 * The page owns the input `value` (controlled); this component is otherwise
 * stateless.
 */
export type SendMode = 'stream' | 'sync'

export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  /** The send mode (D-03); the page owns the state. */
  mode: SendMode
  onModeChange: (mode: SendMode) => void
  /** A stream is in flight: disable the textarea/Send/toggle, show Stop. */
  streaming?: boolean
  /** In-flight (stream OR sync): disable the textarea + Send. */
  disabled?: boolean
  /** Operator Stop (D-04) — aborts the in-flight stream. */
  onStop?: () => void
}

export function Composer({
  value,
  onChange,
  onSend,
  mode,
  onModeChange,
  streaming = false,
  disabled = false,
  onStop,
}: ComposerProps) {
  const canSend = value.trim().length > 0 && !disabled

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline (D-04).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim().length > 0 && !disabled) onSend()
    }
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-md border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
    >
      <Textarea
        aria-label="Message the agent"
        placeholder="Message the agent…"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="flex items-center justify-between gap-2">
        {/* Stream | Sync segmented toggle (D-03) — no new shadcn block. */}
        <div
          role="group"
          aria-label="Send mode"
          className="flex overflow-hidden rounded-md border"
          style={{ borderColor: 'var(--border)' }}
        >
          <ModeSegment
            label="Stream"
            active={mode === 'stream'}
            disabled={streaming}
            onClick={() => onModeChange('stream')}
          />
          <ModeSegment
            label="Sync"
            active={mode === 'sync'}
            disabled={streaming}
            title="One-shot reply, no live steps."
            onClick={() => onModeChange('sync')}
          />
        </div>

        {streaming ? (
          <Button
            type="button"
            variant="outline"
            onClick={onStop}
            // Neutral — NOT destructive-red, NOT accent (D-05: Stop is benign).
          >
            Stop
          </Button>
        ) : (
          <Button type="button" onClick={onSend} disabled={!canSend}>
            Send
          </Button>
        )}
      </div>
    </div>
  )
}

interface ModeSegmentProps {
  label: string
  active: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
}

function ModeSegment({ label, active, disabled, title, onClick }: ModeSegmentProps) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className="px-3 py-1 text-xs disabled:opacity-50"
      style={{
        background: active ? 'var(--primary)' : 'transparent',
        color: active ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
      }}
    >
      {label}
    </button>
  )
}
