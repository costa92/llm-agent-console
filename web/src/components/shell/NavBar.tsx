import { Link } from '@tanstack/react-router'
import { Database, MessageSquare, Workflow, type LucideIcon } from 'lucide-react'

/**
 * Persistent left navigation. Active route gets the blue accent (UI-SPEC: accent
 * reserved for the active nav item). Memory / Flow / Chat are Phase-1
 * placeholders. 224px expanded width per UI-SPEC shell chrome.
 */
type NavItem = {
  to: string
  label: string
  icon: LucideIcon
}

const ITEMS: NavItem[] = [
  { to: '/memory', label: 'Memory', icon: Database },
  { to: '/flows', label: 'Flow', icon: Workflow },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
]

export function NavBar() {
  return (
    <nav
      className="flex w-56 shrink-0 flex-col gap-1 border-r p-2"
      style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
      aria-label="Primary"
    >
      {ITEMS.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          className="flex h-10 items-center gap-2 rounded-md px-3 py-2 text-[14px]"
          style={{ color: 'var(--muted-foreground)' }}
          activeProps={{
            className:
              'flex h-10 items-center gap-2 rounded-md px-3 py-2 text-[14px] nav-active',
            style: { color: 'var(--primary)' },
          }}
        >
          <Icon className="size-4" aria-hidden />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  )
}
