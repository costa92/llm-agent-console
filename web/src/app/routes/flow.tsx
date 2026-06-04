import { createRoute } from '@tanstack/react-router'
import { rootRoute } from '@/app/routes/__root'
import { FlowsPage } from '@/features/flow/FlowsPage'
import { FlowDetailPage } from '@/features/flow/FlowDetailPage'

/**
 * Flow routes (D-05 / IC-1). Flow detail is a FULL ROUTE (not a search-param
 * drawer) — a flow carries the editor + runs + run timelines, far more than a
 * memory item. Three routes:
 *   - `/flows`        → the flows list (FlowsPage)
 *   - `/flows/new`    → the editor in CREATE mode (blank/templated)
 *   - `/flows/$flowId`→ the flow detail (Definition / Runs tabs) + edit-mode editor
 *
 * `/flows/new` is registered BEFORE `/flows/$flowId` so the literal segment wins
 * over the param segment (TanStack matches literals ahead of params; the order
 * also makes the intent explicit).
 */

export const flowsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/flows',
  component: FlowsPage,
})

export const flowNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/flows/new',
  component: () => <FlowDetailPage mode="create" />,
})

export const flowDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/flows/$flowId',
  component: FlowDetailRouteComponent,
})

/** Read `$flowId` from the route params and render the detail page in edit mode. */
function FlowDetailRouteComponent() {
  const { flowId } = flowDetailRoute.useParams()
  return <FlowDetailPage mode="edit" flowId={flowId} />
}
