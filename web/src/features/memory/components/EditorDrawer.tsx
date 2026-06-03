import { useMemo, useState } from 'react'
import { Loader } from 'lucide-react'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { writeRecordSchema, patchFieldsSchema } from '../api/schemas'
import type { MemoryItem } from '../api/schemas'
import { useWriteMutation, usePatchMutation } from '../hooks/useMemoryMutations'
import { useMemorySearchParams } from '../hooks/useMemorySearchParams'

/**
 * EditorDrawer — one editor, two modes (D-07/D-08/IC-3).
 *
 * The SAME component serves "New record" (write mode, a blank/templated record)
 * and "Patch" (patch mode, pre-filled with the item's patchable fields). It is a
 * raw-JSON mono textarea gated by a validation ladder before Submit:
 *   1. JSON.parse → on failure "Invalid JSON — {message}." disables Submit
 *   2. zod (writeRecordSchema | patchFieldsSchema) → on failure "{field}: {rule}."
 *      disables Submit
 * The accent (single blue) Submit is enabled only when BOTH pass.
 *
 * The editor edits ONLY the operator's record/patch OBJECT. The console — not the
 * operator — assembles the request envelope (the empty scope, the fresh
 * idempotency token, and the OCC version) down in client.ts / the mutation hook.
 * The textarea template therefore NEVER contains any of those envelope fields
 * (T-02C1-01 confused-deputy guard) — only the writable/patchable record fields.
 *
 * Submit is pessimistic (D-11): it disables + spins on the mutation's isPending;
 * state reflects only after the backend confirms. On write success the editor
 * closes and offers to open the new item (sets ?item); on patch success the hook
 * refetches GET item + merges the recall row version and the editor closes.
 * Neither path re-runs recall (D-09).
 *
 * The PARTIAL banner (a 200 mutation whose refetch-after fails) is NOT shown
 * here — it surfaces in the open ItemDrawer body (which reads the per-item
 * partial marker the hook sets). The editor just closes on the 200 (the change
 * landed).
 */

/** Write-mode seed: the record OBJECT only — no request-envelope fields. */
const WRITE_TEMPLATE = JSON.stringify({ kind: 'semantic', content: '' }, null, 2)

const PATCH_NOTE =
  'Only content, category, tags, importance are patchable. Use the lifecycle actions for pin/disable.'

/** Pick the patchable subset of an item as the patch-mode seed (D-07). */
function patchSeed(item: MemoryItem): string {
  const seed: Record<string, unknown> = {}
  if (item.content != null) seed.content = item.content
  if (item.category != null) seed.category = item.category
  if (item.tags != null) seed.tags = item.tags
  if (item.importance != null) seed.importance = item.importance
  return JSON.stringify(seed, null, 2)
}

type ValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string }

/** The JSON.parse → zod ladder. Returns the first failing rung's copy. */
function validate(text: string, mode: 'write' | 'patch'): ValidationResult {
  // Rung 1: JSON.parse.
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unexpected token'
    return { ok: false, message: `Invalid JSON — ${msg}.` }
  }
  // Rung 2: zod schema (the record/patch object, not the envelope).
  const schema = mode === 'write' ? writeRecordSchema : patchFieldsSchema
  const result = schema.safeParse(parsed)
  if (!result.success) {
    const issue = result.error.issues[0]
    const field = issue.path.join('.') || 'patch'
    // writeRecordSchema's content message is already "content: required."; for
    // other issues build "{field}: {rule}." per the UI-SPEC schema-error copy.
    const message = /:/.test(issue.message)
      ? issue.message
      : `${field}: ${issue.message}`
    return { ok: false, message: message.endsWith('.') ? message : `${message}.` }
  }
  return { ok: true, value: result.data }
}

export type EditorDrawerProps = {
  mode: 'write' | 'patch'
  item?: MemoryItem
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditorDrawer({ mode, item, open, onOpenChange }: EditorDrawerProps) {
  const initial = useMemo(
    () => (mode === 'patch' && item ? patchSeed(item) : WRITE_TEMPLATE),
    [mode, item],
  )
  // Keyed remount (below) resets this when the drawer reopens in a new mode/item.
  const [text, setText] = useState(initial)

  const writeMutation = useWriteMutation()
  const patchMutation = usePatchMutation()
  const { setItem } = useMemorySearchParams()

  const validation = validate(text, mode)
  const isPending =
    mode === 'write' ? writeMutation.isPending : patchMutation.isPending
  const canSubmit = validation.ok && !isPending

  function handleSubmit() {
    if (!validation.ok) return
    if (mode === 'write') {
      writeMutation.mutate(
        validation.value as Parameters<typeof writeMutation.mutate>[0],
        {
          onSuccess: (res) => {
            onOpenChange(false)
            // Offer to open the freshly-written item (sets ?item → ItemDrawer).
            setItem(res.memory.memory_id)
          },
        },
      )
      return
    }
    // Patch mode: thread the open item's id + its current OCC version. The
    // console supplies the version from the loaded item — the operator never
    // edits it (the textarea holds only the patch object).
    if (!item) return
    patchMutation.mutate(
      {
        id: item.memory_id,
        patch: validation.value as Parameters<typeof patchMutation.mutate>[0]['patch'],
        expected_version: item.version,
      },
      {
        onSuccess: () => {
          onOpenChange(false)
        },
      },
    )
  }

  const title = mode === 'write' ? 'New record' : 'Patch item'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[480px] flex-col gap-4 p-4 sm:max-w-[480px]"
      >
        <SheetHeader className="px-0 pt-0">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="sr-only">
            {mode === 'write'
              ? 'Author a new memory record as JSON.'
              : 'Edit the patchable fields of this memory item as JSON.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="editor-json">
            {mode === 'write' ? 'Record (JSON)' : 'Patch (JSON)'}
          </Label>
          {mode === 'patch' && (
            <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              {PATCH_NOTE}
            </p>
          )}
          <Textarea
            id="editor-json"
            aria-label="editor json"
            className="mono min-h-64 flex-1 text-sm"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {/* Inline validation copy (red) — parse error or first schema issue. */}
          {!validation.ok && (
            <p
              role="alert"
              className="text-sm"
              style={{ color: 'var(--status-down)' }}
            >
              {validation.message}
            </p>
          )}
        </div>

        <SheetFooter className="px-0 pb-0">
          {/* Submit is the single accent (blue) action; disabled until the ladder
              passes and not pending (pessimistic, D-11). */}
          <Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
            {isPending && (
              <Loader className="size-4 animate-spin" aria-hidden />
            )}
            {isPending ? 'Submitting…' : 'Submit'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
