import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { OperatorContextProvider } from '@/app/OperatorContextProvider'
import { routeTree } from '@/app/router'
import { Toaster } from '@/components/ui/sonner'
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

const router = createRouter({ routeTree })

// Type-safe router registration for TanStack Router.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OperatorContextProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster />
      </QueryClientProvider>
    </OperatorContextProvider>
  </StrictMode>,
)
