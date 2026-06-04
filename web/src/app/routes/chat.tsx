import { createRoute } from '@tanstack/react-router'
import { rootRoute } from '@/app/routes/__root'
import { ChatPage } from '@/features/chat/ChatPage'

export const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat',
  component: ChatPage,
})
