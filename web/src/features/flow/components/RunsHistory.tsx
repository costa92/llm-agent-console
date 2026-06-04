import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  History,
  Loader,
  XCircle,
} from 'lucide-react'

import { CopyableId } from '@/components/primitives/CopyableId'
import { FiveStateWrapper } from '@/components/primitives/FiveStateWrapper'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useRunsQuery } from '@/features/flow/api/queries'
import { FlowdError } from '@/features/flow/api/client'
import type { RunMeta, RunStatus } from '@/features/flow/api/schemas'

const PAGE_SIZE = 25

/**
 * Run-status badge (S7 / S8 / Color table (d) / D-07). flowd `status ∈
 * {running, done, failed}` → color + icon + text so the state never relies on
 * color alone (color-blind safe):
 *
 *   running → muted slate, spinning loader  (--status-unknown)
 *   done    → green, check-circle           (--status-up)
 *   failed  → RED, x-circle                 (--status-down)
 *
 * Exported so the run sub-route summary (RunDetail) renders the IDENTICAL badge.
 */
const RUN_STATUS_META: Record<
  RunStatus,
  { token: string; label: string; Icon: typeof Loader; spin?: boolean }
> = {
  running: {
    token: 'var(--status-unknown)',
    label: 'Running',
    Icon: Loader,
    spin: true,
  },
  done: { token: 'var(--status-up)', label: 'Done', Icon: CheckCircle },
  failed: { token: 'var(--status-down)', label: 'Failed', Icon: XCircle },
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const meta = RUN_STATUS_META[status]
  const Icon = meta.Icon
  return (
    <Badge
      variant="outline"
      data-run-status={status}
      style={{
        color: meta.token,
        borderColor: meta.token,
        background: 'color-mix(in oklch, ' + meta.token + ' 12%, transparent)',
      }}
    >
      <Icon
        className={meta.spin ? 'size-3.5 animate-spin' : 'size-3.5'}
        aria-hidden
      />
      {meta.label}
    </Badge>
  )
}

/**
 * Run-history table (S7 / FLOW-05 / D-07 / IC-7) — mounted on the flow-detail
 * Runs tab (filling the Slice-A placeholder slot).
 *
 * A client-side `@tanstack/react-table` over `useRunsQuery(flowId)` →
 * `{runs:[RunMeta]}` (sort + pagination client-side over the fetched rows;
 * mirrors the Phase-2 ResultsTable / Slice-A FlowsTable pattern — flowd returns
 * a flat list, no server sort/offset). Columns:
 *   - `run_id`     → CopyableId (mono)
 *   - status       → the run-status badge (running/done/failed; Color (d))
 *   - `started_at` → mono Label
 *   - `finished_at`→ mono Label; omitted while running → renders "—"
 *
 * Row click navigates to the deep-linkable run sub-route
 * `/flows/{flowId}/runs/{runId}` (S8) — the single live+replay render location.
 *
 * Wrapped in the Phase-1 five-state primitive: loading / error
 * ("{status} from flowd — {error}.") / ready. An empty list renders the
 * FLOW-specific "No runs yet." empty state INSIDE the ready slot (NOT the
 * primitive's generic unset-context EmptyState — flowd has no context gate;
 * same convention as FlowsTable).
 *
 * All flowd strings (run ids, timestamps) render as React TEXT children — never
 * innerHTML (T-03-V5).
 */
export interface RunsHistoryProps {
  flowId: string
}

export function RunsHistory({ flowId }: RunsHistoryProps) {
  const navigate = useNavigate()
  const runsQuery = useRunsQuery(flowId)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'started_at', desc: true },
  ])

  const columns = useMemo<ColumnDef<RunMeta>[]>(
    () => [
      {
        accessorKey: 'id',
        header: 'run_id',
        enableSorting: true,
        cell: ({ row }) => (
          // CopyableId stops row-click propagation itself (the copy button) — the
          // wrapper span guards the mono id text against the row navigation.
          <span onClick={(e) => e.stopPropagation()} className="inline-flex">
            <CopyableId id={row.original.id} />
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'status',
        enableSorting: true,
        cell: ({ row }) => <RunStatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'started_at',
        header: 'started_at',
        enableSorting: true,
        cell: ({ row }) => (
          <span
            className="mono text-xs"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {row.original.started_at}
          </span>
        ),
      },
      {
        accessorKey: 'finished_at',
        header: 'finished_at',
        enableSorting: true,
        cell: ({ row }) => (
          // finished_at is omitted while a run is still running → render "—".
          <span
            className="mono text-xs"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {row.original.finished_at ?? '—'}
          </span>
        ),
      },
    ],
    [],
  )

  const runs = runsQuery.data ?? []

  const table = useReactTable({
    data: runs,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: PAGE_SIZE } },
  })

  // Map the FlowdError (flat {error}) onto the five-state error contract.
  const err = runsQuery.error
  const errorState =
    err != null
      ? {
          status: err instanceof FlowdError ? err.status : undefined,
          service: 'flowd',
          message: err instanceof Error ? err.message : 'request failed',
        }
      : null

  return (
    <FiveStateWrapper
      loading={runsQuery.isLoading}
      error={errorState}
      onRetry={() => void runsQuery.refetch()}
    >
      {runs.length === 0 ? (
        <NoRunsEmptyState />
      ) : (
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
                className="cursor-pointer"
                onClick={() =>
                  void navigate({
                    to: '/flows/$flowId/runs/$runId',
                    params: { flowId, runId: row.original.id },
                  })
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
      )}
    </FiveStateWrapper>
  )
}

/** No-runs empty state (UI-SPEC copy): "No runs yet." + the run-to-see hint. */
function NoRunsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <History
        className="size-4"
        style={{ color: 'var(--muted-foreground)' }}
        aria-hidden
      />
      <h3
        className="text-[20px] font-semibold"
        style={{ color: 'var(--foreground)' }}
      >
        No runs yet.
      </h3>
      <p className="max-w-md text-sm" style={{ color: 'var(--muted-foreground)' }}>
        Run this flow to see its execution history here.
      </p>
    </div>
  )
}
