import type { KeyboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

/**
 * The chat composer (S4 / IC-4 / D-04, sync slice).
 *
 * A multi-line `textarea` (placeholder "Message the agent…") + a primary "Send"
 * button. Enter sends (preventDefault + onSend when the value is non-empty),
 * Shift+Enter inserts a newline. Send is disabled when the value is
 * empty/whitespace-only OR the `disabled` prop is true (in-flight).
 *
 * The page owns the input `value` (controlled); this component is otherwise
 * stateless. The sync/stream toggle + the Stop button arrive in 04-03 — a
 * clearly-marked toolbar SEAM is left below the textarea for them; do NOT build
 * them here.
 */
export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  /** In-flight: disable the textarea + Send (no concurrent turns). */
  disabled?: boolean
  /** Request in flight (currently mirrors `disabled`; 04-03 swaps Send↔Stop). */
  sending?: boolean
}

export function Composer({
  value,
  onChange,
  onSend,
  disabled = false,
  sending = false,
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
      <div className="flex items-center justify-end gap-2">
        {/* SEAM (04-03): the Stream|Sync toggle + Stop button mount here. */}
        <Button type="button" onClick={onSend} disabled={!canSend || sending}>
          Send
        </Button>
      </div>
    </div>
  )
}
