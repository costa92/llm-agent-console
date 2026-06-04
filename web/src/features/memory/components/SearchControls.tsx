import { useState } from 'react'
import { ChevronDown, ChevronRight, RotateCw, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  TOP_K_DEFAULT,
  TOP_K_MAX,
  TOP_K_MIN,
  clampTopK,
  useMemorySearchParams,
} from '../hooks/useMemorySearchParams'

export interface SearchControlsProps {
  /** Re-POST the current recall (manual "Refresh search"; D-09 — never auto). */
  onRefresh: () => void
}

/**
 * Search controls (S1 / MEM-01 / D-01-02). Always visible: the query input +
 * top_k stepper + the primary accent "Recall" button. Behind a collapsed-by-
 * default "Advanced" Collapsible: score-threshold + a pinned-only toggle + a
 * disabled filter — all bound to the URL search params (D-02). A neutral
 * "Refresh search" re-POSTs the current recall (D-09 — never auto after a
 * mutation).
 *
 * Recall writes query + top_k into the URL (the recall query is driven by the
 * URL, so the search is reproducible/shareable). top_k is the ONLY server
 * re-query lever (IC-1) — the gateway exposes no server ordering/windowing
 * controls, so none are rendered here.
 */
export function SearchControls({ onRefresh }: SearchControlsProps) {
  const params = useMemorySearchParams()

  // Local draft state for query + top_k so typing doesn't re-POST per keystroke;
  // the URL (and therefore recall) only updates on Recall submit.
  const [draftQuery, setDraftQuery] = useState(params.query)
  const [draftTopK, setDraftTopK] = useState(String(params.top_k))
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // Adjust the draft DURING render when the URL changes underneath (e.g. a
  // shared link loads, or browser-back) — the React-recommended "store the
  // synced value" pattern (no setState-in-effect). `syncedFrom` mirrors the URL
  // value the draft was last reset from.
  const [syncedFrom, setSyncedFrom] = useState({
    query: params.query,
    top_k: params.top_k,
  })
  if (
    syncedFrom.query !== params.query ||
    syncedFrom.top_k !== params.top_k
  ) {
    setSyncedFrom({ query: params.query, top_k: params.top_k })
    setDraftQuery(params.query)
    setDraftTopK(String(params.top_k))
  }

  function submitRecall(e: React.FormEvent) {
    e.preventDefault()
    const k = clampTopK(Number(draftTopK))
    params.setSearch({ query: draftQuery, top_k: k })
  }

  return (
    <form onSubmit={submitRecall} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
          <Label htmlFor="memory-query">Query</Label>
          <Input
            id="memory-query"
            value={draftQuery}
            onChange={(e) => setDraftQuery(e.target.value)}
            placeholder="Search memory…"
          />
        </div>

        <div className="flex w-24 flex-col gap-1.5">
          <Label htmlFor="memory-top-k">top_k</Label>
          <Input
            id="memory-top-k"
            type="number"
            min={TOP_K_MIN}
            max={TOP_K_MAX}
            value={draftTopK}
            onChange={(e) => setDraftTopK(e.target.value)}
            className="mono"
          />
        </div>

        {/* Primary accent action of this surface (UI-SPEC accent-reserved). */}
        <Button type="submit">
          <Search className="size-4" aria-hidden />
          Recall
        </Button>

        {/* Neutral manual re-POST — never auto-runs after a mutation (D-09). */}
        <Button type="button" variant="ghost" onClick={onRefresh}>
          <RotateCw className="size-4" aria-hidden />
          Refresh search
        </Button>
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {advancedOpen ? (
              <ChevronDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden />
            )}
            Advanced
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div
            className="mt-2 flex flex-wrap items-end gap-4 rounded-md border p-4"
            style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
          >
            <div className="flex w-40 flex-col gap-1.5">
              <Label htmlFor="memory-score-threshold">Score threshold</Label>
              <Input
                id="memory-score-threshold"
                type="number"
                step="0.01"
                min={0}
                max={1}
                className="mono"
                value={params.scoreThreshold ?? ''}
                onChange={(e) =>
                  params.setScoreThreshold(
                    e.target.value === '' ? undefined : Number(e.target.value),
                  )
                }
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={params.pinnedOnly ?? false}
                onChange={(e) =>
                  params.setPinnedOnly(e.target.checked ? true : undefined)
                }
              />
              Pinned only
            </label>

            <div className="flex w-40 flex-col gap-1.5">
              <Label htmlFor="memory-disabled-filter">Disabled</Label>
              <select
                id="memory-disabled-filter"
                className="h-9 rounded-md border px-2 text-sm"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--background)',
                }}
                value={params.disabledFilter ?? 'show'}
                onChange={(e) =>
                  params.setDisabledFilter(
                    e.target.value === 'show'
                      ? undefined
                      : (e.target.value as 'hide' | 'only'),
                  )
                }
              >
                <option value="show">Show all</option>
                <option value="hide">Hide disabled</option>
                <option value="only">Disabled only</option>
              </select>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </form>
  )
}

export { TOP_K_DEFAULT }
