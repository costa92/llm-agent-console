import { createRoute } from '@tanstack/react-router'
import { rootRoute } from '@/app/routes/__root'

function ChatPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-[14px]" style={{ color: 'var(--muted-foreground)' }}>
        Chat console — arrives in Phase 4.
      </p>
    </div>
  )
}

export const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat',
  component: ChatPlaceholder,
})
