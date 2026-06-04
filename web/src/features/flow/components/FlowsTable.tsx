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
import { ArrowDown, ArrowUp, FileJson } from 'lucide-react'

import { CopyableId } from '@/components/primitives/CopyableId'
import { FiveStateWrapper } from '@/components/primitives/FiveStateWrapper'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useFlowsQuery } from '@/features/flow/api/queries'
import { FlowdError } from '@/features/flow/api/client'
import type { FlowMeta } from '@/features/flow/api/schemas'

const PAGE_SIZE = 25

/**
 * Flows list table (S1 / FLOW-01 / IC-1).
 *
 * A client-side `@tanstack/react-table` over `useFlowsQuery()` → `{flows}` — sort
 * and pagination are client-side over the fetched rows (no server sort/offset;
 * mirrors the Phase-2 `ResultsTable` pattern). Columns: `flow.id` (CopyableId,
 * mono) · `name` (sans, falls back to id) · `created_at` / `updated_at` (mono
 * Label). Row click navigates to the full detail route `/flows/{id}`.
 *
 * flowd strings (id, name, error) render as React TEXT children — never
 * innerHTML (T-03-V5). Wrapped in the Phase-1 five-state primitive: loading /
 * empty ("No flows yet." + New flow) / error ("{status} from flowd — {error}.")
 * / ready. The flat flowd error envelope surfaces verbatim (BFF-04 passthrough).
 */
export function FlowsTable() {
  const navigate = useNavigate()
  const flowsQuery = useFlowsQuery()
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'updated_at', desc: true },
  ])

  const columns = useMemo<ColumnDef<FlowMeta>[]>(
    () => [
      {
        accessorKey: 'id',
        header: 'flow.id',
        enableSorting: true,
        cell: ({ row }) => (
          <span onClick={(e) => e.stopPropagation()} className="inline-flex">
            <CopyableId id={row.original.id} />
          </span>
        ),
      },
      {
        accessorKey: 'name',
        header: 'name',
        enableSorting: true,
        cell: ({ row }) => (
          // Sans Body prose; falls back to the id when name is absent. TEXT node.
          <span className="text-sm" style={{ color: 'var(--foreground)' }}>
            {row.original.name ?? row.original.id}
          </span>
        ),
      },
      {
        accessorKey: 'created_at',
        header: 'created_at',
        enableSorting: true,
        cell: ({ row }) => (
          <span className="mono text-xs" style={{ color: 'var(--muted-foreground)' }}>
            {row.original.created_at}
          </span>
        ),
      },
      {
        accessorKey: 'updated_at',
        header: 'updated_at',
        enableSorting: true,
        cell: ({ row }) => (
          <span className="mono text-xs" style={{ color: 'var(--muted-foreground)' }}>
            {row.original.updated_at}
          </span>
        ),
      },
    ],
    [],
  )

  const flows = flowsQuery.data ?? []

  const table = useReactTable({
    data: flows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: PAGE_SIZE } },
  })

  // Map the FlowdError (flat {error}) onto the five-state error contract.
  const err = flowsQuery.error
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
      loading={flowsQuery.isLoading}
      error={errorState}
      onRetry={() => void flowsQuery.refetch()}
    >
      {flows.length === 0 ? (
        // FLOW-specific empty state — NOT the FiveStateWrapper generic
        // unset-context EmptyState (that one is the MEM-08 context gate). We
        // render our own copy + CTA inside the ready slot so it never collides.
        <NoFlowsEmptyState onNew={() => void navigate({ to: '/flows/new' })} />
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
                    to: '/flows/$flowId',
                    params: { flowId: row.original.id },
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

/** No-flows empty state (UI-SPEC copy): "No flows yet." + the New flow CTA. */
function NoFlowsEmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <FileJson
        className="size-4"
        style={{ color: 'var(--muted-foreground)' }}
        aria-hidden
      />
      <h3
        className="text-[20px] font-semibold"
        style={{ color: 'var(--foreground)' }}
      >
        No flows yet.
      </h3>
      <p className="max-w-md text-sm" style={{ color: 'var(--muted-foreground)' }}>
        Create a flow as JSON to run and observe it.
      </p>
      <Button onClick={onNew}>New flow</Button>
    </div>
  )
}
