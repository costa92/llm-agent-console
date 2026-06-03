import { createRoute } from '@tanstack/react-router'
import { rootRoute } from '@/app/routes/__root'

function MemoryPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-[14px]" style={{ color: 'var(--muted-foreground)' }}>
        Memory console — arrives in Phase 2.
      </p>
    </div>
  )
}

export const memoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/memory',
  component: MemoryPlaceholder,
})
