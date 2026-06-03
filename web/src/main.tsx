import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import './index.css'

// REST data layer. SSE streams bypass this cache and are driven imperatively
// (see RESEARCH.md SSE section) — they are added in later phases.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

// Placeholder route tree. Plan 04 replaces this root with the full app shell
// (nav + operator-context bar + env indicator) and the named Memory/Flow/Chat
// routes. For now the root renders a loading indicator so the harness is wired
// end-to-end (React 19 + TanStack Router + TanStack Query) without committing to
// the route surface that the shell plan owns.
const rootRoute = createRootRoute({
  component: function RootPlaceholder() {
    return (
      <div className="mono" style={{ padding: 16, color: 'var(--muted-foreground)' }}>
        Loading…
      </div>
    )
  },
})

const routeTree = rootRoute

const router = createRouter({ routeTree })

// Type-safe router registration for TanStack Router.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
