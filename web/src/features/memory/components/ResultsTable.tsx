import { useMemo, useState } from 'react'
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp } from 'lucide-react'

import { CopyableId } from '@/components/primitives/CopyableId'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { RecallHit } from '@/features/memory/api/schemas'
import { useMemorySearchParams } from '../hooks/useMemorySearchParams'
import { DisabledBadge, PinnedBadge } from './StateBadges'
import { LifecycleActions } from './LifecycleActions'

export interface ResultsTableProps {
  /** The fetched recall hits (already score-desc from the gateway). */
  hits: RecallHit[]
  /** The operator's requested top_k cap — drives the IC-1 at-cap hint. */
  topK: number
}

const PAGE_SIZE = 25

/**
 * Recall results table (S2 / MEM-01 / D-03 forced client-side).
 *
 * Sort, pagination, and pinned/disabled filtering are ALL client-side over the
 * fetched hits (`@tanstack/react-table` `getSortedRowModel` /
 * `getPaginationRowModel` / `getFilteredRowModel`) — the gateway returns a flat
 * ranked `hits[]` with no server sort/offset/page (D-03). The table NEVER
 * re-fetches; the only server re-query lever is top_k in SearchControls (IC-1).
 *
 * Gateway strings (content) are rendered as React TEXT children — never via the
 * raw-HTML escape hatch (stored-XSS mitigation V5 / T-02A-01).
 */
export function ResultsTable({ hits, topK }: ResultsTableProps) {
  const params = useMemorySearchParams()
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'score', desc: true },
  ])

  // Apply the Advanced client filters (D-13) as a row predicate over props.
  // This is client-side over the already-fetched top-k — no re-fetch.
  const rows = useMemo(() => {
    return hits.filter((hit) => {
      if (params.pinnedOnly && !hit.pinned) return false
      if (params.disabledFilter === 'hide' && hit.disabled) return false
      if (params.disabledFilter === 'only' && !hit.disabled) return false
      if (
        params.scoreThreshold != null &&
        hit.score < params.scoreThreshold
      ) {
        return false
      }
      return true
    })
  }, [hits, params.pinnedOnly, params.disabledFilter, params.scoreThreshold])

  const columns = useMemo<ColumnDef<RecallHit>[]>(
    () => [
      {
        accessorKey: 'memory_id',
        header: 'memory_id',
        enableSorting: true,
        cell: ({ row }) => (
          <span
            onClick={(e) => e.stopPropagation()}
            className="inline-flex"
          >
            <CopyableId id={row.original.memory_id} />
          </span>
        ),
      },
      {
        accessorKey: 'score',
        header: 'score',
        enableSorting: true,
        sortingFn: 'basic',
        cell: ({ row }) => (
          <span className="mono block text-right tabular-nums">
            {row.original.score.toFixed(2)}
          </span>
        ),
      },
      {
        accessorKey: 'kind',
        header: 'kind',
        cell: ({ row }) => (
          <span className="text-xs font-semibold uppercase tracking-[0.04em]">
            {row.original.kind}
          </span>
        ),
      },
      {
        id: 'source',
        header: 'source',
        cell: ({ row }) => (
          <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            {row.original.source ?? row.original.category ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'content',
        header: 'content',
        cell: ({ row }) => (
          // Gateway string rendered as a TEXT child — never innerHTML (V5).
          <span className="line-clamp-1 max-w-md text-sm">
            {row.original.content}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'status',
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5">
            {row.original.pinned && <PinnedBadge />}
            {row.original.disabled && <DisabledBadge />}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          // Row quick-actions menu (D-06): pin/disable/delete for fast triage,
          // without opening the drawer. The component stops row-click
          // propagation itself. expected_version is threaded from the hit.
          <LifecycleActions
            item={{
              memory_id: row.original.memory_id,
              version: row.original.version,
              pinned: row.original.pinned,
              disabled: row.original.disabled,
            }}
            variant="row"
          />
        ),
      },
    ],
    [],
  )

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    initialState: { pagination: { pageSize: PAGE_SIZE } },
  })

  // Row click → set ?item={memory_id} so plan 02-03's drawer opens (IC-2).
  function openItem(memory_id: string) {
    params.setSearch({ item: memory_id })
  }

  // IC-1 at-cap hint: when the gateway returned a full page at the requested
  // cap, more may exist — nudge raising top_k (the only "see more" lever).
  const atCap = hits.length === topK

  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sortDir = header.column.getIsSorted()
                return (
                  <TableHead
                    key={header.id}
                    className="text-xs font-semibold uppercase tracking-[0.04em]"
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {sortDir === 'asc' && (
                          <ArrowUp
                            className="size-3.5"
                            style={{ color: 'var(--primary)' }}
                            aria-hidden
                          />
                        )}
                        {sortDir === 'desc' && (
                          <ArrowDown
                            className="size-3.5"
                            style={{ color: 'var(--primary)' }}
                            aria-hidden
                          />
                        )}
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              onClick={() => openItem(row.original.memory_id)}
              className={cn(
                'cursor-pointer',
                row.original.disabled && 'opacity-60',
              )}
              style={
                row.original.disabled
                  ? { color: 'var(--muted-foreground)' }
                  : undefined
              }
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className="py-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {atCap && (
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Showing top {hits.length}. Increase top-k to pull more (max 50).
        </p>
      )}
    </div>
  )
}
