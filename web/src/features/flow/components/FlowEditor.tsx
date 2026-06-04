import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader } from 'lucide-react'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { usePutFlow, useCreateFlow } from '../hooks/useFlowMutations'

/**
 * FlowEditor — the route-hosted raw-JSON + zod editor (S3 / IC-2).
 *
 * Reuses the Phase-2 EditorDrawer PATTERN (mono textarea, inline parse error,
 * a JSON.parse → zod well-formedness ladder gating Save) but as a route-hosted
 * surface, not a drawer. Two modes:
 *   - edit   → seeded with the DECODED flow IR (the parent passes the already
 *              base64-decoded `flow` from getFlow — no `eyJ…` base64 reaches the
 *              textarea). Save = PUT {name?, flow} with the RAW flow + id OMITTED
 *              (client-enforced, Pitfall 4).
 *   - create → seeded with a minimal valid flow-IR skeleton. Save = POST → 201 →
 *              navigate to /flows/{newId}.
 *
 * Validation ladder (Save accent disabled while it fails):
 *   1. JSON.parse  → "Invalid JSON — {message}." (Save disabled)
 *   2. zod well-formedness → the flow must be a JSON OBJECT (flowd is the
 *      AUTHORITATIVE semantic validator — compileProbe 400; the client only
 *      checks well-formedness, then surfaces flowd's verbatim compile error in a
 *      toast).
 *
 * The flow JSON renders ONLY into the mono textarea (a plain-text control) — the
 * name/error strings render as React TEXT nodes; never innerHTML (T-03-V5).
 */

/** Create-mode seed: a minimal valid flow-IR skeleton (UI-SPEC / flowd shape). */
const CREATE_TEMPLATE = JSON.stringify(
  { id: '', nodes: [], edges: [] },
  null,
  2,
)

/**
 * Well-formedness gate: the flow IR must be a JSON object (not an array, string,
 * or number). flowd owns the real semantic validation (compileProbe → 400).
 */
const flowWellFormedSchema = z.looseObject({})

type ValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string }

/** The JSON.parse → zod well-formedness ladder. Returns the first failure copy. */
function validate(text: string): ValidationResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unexpected token'
    return { ok: false, message: `Invalid JSON — ${msg}.` }
  }
  const result = flowWellFormedSchema.safeParse(parsed)
  if (!result.success) {
    return { ok: false, message: 'Flow must be a JSON object.' }
  }
  return { ok: true, value: parsed }
}

export type FlowEditorProps =
  | { mode: 'create' }
  | {
      mode: 'edit'
      flowId: string
      /** The base64-DECODED flow IR (from getFlow) — never the raw base64. */
      flow: unknown
      /** The flow's current name (threaded through PUT unchanged). */
      name?: string
    }

export function FlowEditor(props: FlowEditorProps) {
  const navigate = useNavigate()
  const putM = usePutFlow()
  const createM = useCreateFlow()

  // Seed: edit mode → the decoded flow IR pretty-printed; create → the skeleton.
  const initial = useMemo(() => {
    if (props.mode === 'edit') return JSON.stringify(props.flow, null, 2)
    return CREATE_TEMPLATE
  }, [props])

  const [text, setText] = useState(initial)
  // Create mode lets the operator name the new flow + set its id.
  const [createId, setCreateId] = useState('')
  const [createName, setCreateName] = useState('')

  const validation = validate(text)
  const isPending = props.mode === 'edit' ? putM.isPending : createM.isPending
  const canSubmit = validation.ok && !isPending

  function handleSubmit() {
    if (!validation.ok) return
    if (props.mode === 'edit') {
      // PUT sends the raw flow + OMITS id (the client enforces the omit). The
      // name is threaded unchanged.
      putM.mutate({ id: props.flowId, flow: validation.value, name: props.name })
      return
    }
    // Create: POST {id, name?, flow} → 201 → route to the new flow.
    createM.mutate(
      {
        ...(createId ? { id: createId } : {}),
        ...(createName ? { name: createName } : {}),
        flow: validation.value,
      },
      {
        onSuccess: (rec) => {
          void navigate({
            to: '/flows/$flowId',
            params: { flowId: rec.id },
          })
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-4" aria-label="Flow editor">
      {props.mode === 'create' && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="flow-id">Flow id</Label>
            <Input
              id="flow-id"
              aria-label="flow id"
              className="mono text-sm"
              placeholder="echo_chain"
              value={createId}
              onChange={(e) => setCreateId(e.target.value)}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="flow-name">Name (optional)</Label>
            <Input
              id="flow-name"
              aria-label="flow name"
              className="text-sm"
              placeholder="Echo Chain"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="flow-json">Flow (JSON)</Label>
        <Textarea
          id="flow-json"
          aria-label="flow json"
          className="mono min-h-72 text-sm"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {/* Inline parse/well-formedness error (red) — TEXT node. */}
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

      <div className="flex items-center gap-2">
        {/* Save is the single accent (blue) action; disabled until the ladder
            passes and not pending (pessimistic, D-11). */}
        <Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
          {isPending && <Loader className="size-4 animate-spin" aria-hidden />}
          {isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
