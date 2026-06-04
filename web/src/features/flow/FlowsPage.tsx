import { useNavigate } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { FlowsTable } from './components/FlowsTable'

/**
 * Flows route page (S1 / FLOW-01). Hosts the page title, the primary "New flow"
 * action (accent — the single primary action of this surface, opens the
 * route-hosted editor blank/templated at `/flows/new`), and the FlowsTable.
 *
 * No context gate this phase — flowd is NOT scope-aware (unlike Phase-2 MEM-08);
 * all operators see all flows (RESEARCH).
 */
export function FlowsPage() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1
          className="text-[20px] font-semibold"
          style={{ color: 'var(--foreground)' }}
        >
          Flows
        </h1>
        <Button onClick={() => void navigate({ to: '/flows/new' })}>
          New flow
        </Button>
      </header>

      <section aria-label="Flows">
        <FlowsTable />
      </section>
    </div>
  )
}
