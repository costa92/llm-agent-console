import { createRootRoute } from '@tanstack/react-router'
import { Shell } from '@/app/Shell'

/** Root route — renders the app Shell, which hosts the Outlet for child routes. */
export const rootRoute = createRootRoute({
  component: Shell,
})
