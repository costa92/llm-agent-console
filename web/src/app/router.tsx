import { createRoute, redirect } from '@tanstack/react-router'
import { rootRoute } from '@/app/routes/__root'
import { memoryRoute } from '@/app/routes/memory'
import { flowsRoute, flowNewRoute, flowDetailRoute } from '@/app/routes/flow'
import { chatRoute } from '@/app/routes/chat'

/** Index route redirects to /memory so the shell always lands on a console. */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/memory' })
  },
})

/** Assembled route tree — shared by main.tsx and the router tests. */
export const routeTree = rootRoute.addChildren([
  indexRoute,
  memoryRoute,
  flowsRoute,
  flowNewRoute,
  flowDetailRoute,
  chatRoute,
])
