import { createRoute } from '@tanstack/react-router'
import { rootRoute } from '@/app/routes/__root'

function FlowPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-[14px]" style={{ color: 'var(--muted-foreground)' }}>
        Flow console — arrives in Phase 3.
      </p>
    </div>
  )
}

export const flowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/flow',
  component: FlowPlaceholder,
})
