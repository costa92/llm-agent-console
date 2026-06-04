import { Outlet } from '@tanstack/react-router'
import { NavBar } from '@/components/shell/NavBar'
import { TopBar } from '@/components/shell/TopBar'

/**
 * Root shell layout. NavBar (left) + TopBar (top) + a main content region that
 * renders the active route via Outlet. Everything subsequent phases ship
 * renders inside this main region.
 */
export function Shell() {
  return (
    <div
      className="flex h-screen flex-col"
      style={{ backgroundColor: 'var(--background)' }}
    >
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <NavBar />
        <main className="min-w-0 flex-1 overflow-auto p-4">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
