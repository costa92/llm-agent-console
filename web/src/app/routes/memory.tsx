import { createRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { rootRoute } from '@/app/routes/__root'
import { MemoryPage } from '@/features/memory/MemoryPage'

/**
 * Memory route search-param schema (D-02). All reproducible search state — the
 * recall query + top_k, the open-drawer item id, and the Advanced client filters
 * — is validated here so a shared link reconstructs the exact view. Sort/page
 * are NOT here: they are ephemeral client-side table state (D-03).
 *
 * top_k is coerced + clamped 1..50 so a hand-edited URL can never POST an
 * out-of-range top_k the gateway would 400 on.
 */
const memorySearchSchema = z.object({
  query: z.string().optional(),
  top_k: z.coerce.number().int().min(1).max(50).optional(),
  item: z.string().optional(),
  scoreThreshold: z.coerce.number().optional(),
  pinnedOnly: z.coerce.boolean().optional(),
  disabledFilter: z.enum(['hide', 'only']).optional(),
})

export type MemorySearchSchema = z.infer<typeof memorySearchSchema>

export const memoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/memory',
  validateSearch: (search) => memorySearchSchema.parse(search),
  component: MemoryPage,
})
