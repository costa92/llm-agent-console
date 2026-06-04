import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { CopyableId } from '@/components/primitives/CopyableId'

/**
 * The chat session header (S1 / D-02 / D-06).
 *
 * When a `sessionId` is known (server-assigned on the first turn), renders the
 * uppercase "SESSION" caption + the id via the reused `CopyableId` primitive
 * (mono, hover-copy). Pre-first-turn (`sessionId` undefined) it shows the muted
 * "No session yet — send a message to start." copy.
 *
 * The "New session" button fires `onNewSession` DIRECTLY — no confirmation
 * dialog (D-06 is a benign view reset, not a destructive backend op). The header
 * is a Secondary-surface card; this component is purely presentational/prop-
 * driven (the page owns the session state via useChatStream).
 */
export interface SessionHeaderProps {
  /** The server-assigned session id, or undefined pre-first-turn. */
  sessionId: string | undefined
  /** Clear the transcript + reset the id (D-06) — fires directly, no confirm. */
  onNewSession: () => void
}

export function SessionHeader({ sessionId, onNewSession }: SessionHeaderProps) {
  return (
    <header
      aria-label="Chat session"
      className="flex items-center justify-between gap-4 rounded-md border px-4 py-3"
      style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
    >
      <div className="flex items-center gap-2">
        {sessionId ? (
          <>
            <Label
              className="text-xs uppercase tracking-wide"
              style={{ color: 'var(--muted-foreground)' }}
            >
              SESSION
            </Label>
            <CopyableId id={sessionId} />
          </>
        ) : (
          <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            No session yet — send a message to start.
          </span>
        )}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={onNewSession}>
        New session
      </Button>
    </header>
  )
}
