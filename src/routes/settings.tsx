import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
} from '@tanstack/react-router'

import { Chip } from '#/components/v3/ui/chip'
import { cn } from '#/lib/utils'
import { settingsNavForRole } from '#/components/v3/settings/settings-nav'
import type { SettingsNavItem } from '#/components/v3/settings/settings-nav'

/** UI port (roadmap-4/ui-app3): the settings shell. Sections are grouped
 * workspace / account exactly as app-3, and the nav lists only routes that
 * exist so no link 404s. SHELL-01.2: workspace administration sections are
 * omitted for a role that cannot open them (see `settings-nav.ts`). */
export const Route = createFileRoute('/settings')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: SettingsLayout,
})

function SettingsLayout() {
  const { pathname } = useLocation()
  const { context } = Route.useRouteContext()
  const { workspace, account } = settingsNavForRole(context.workspace?.role)
  const item = (i: SettingsNavItem) => {
    const on = i.match(pathname)
    return (
      <Link
        key={i.label}
        {...i.link}
        aria-current={on ? 'page' : undefined}
        className={cn(
          'block rounded-md px-2.5 py-1.5 text-body text-fg no-underline hover:bg-surface-hover hover:text-fg hover:no-underline',
          on && 'bg-selection font-medium hover:bg-selection',
        )}
      >
        {i.label}
      </Link>
    )
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
      <nav
        aria-label="Settings"
        className="hidden w-[220px] shrink-0 flex-col gap-px overflow-y-auto border-r border-border-subtle px-3 py-4 lg:flex"
      >
        {workspace.length > 0 ? (
          <div className="px-2.5 pb-1 pt-2 text-label font-medium text-fg-muted">
            Workspace
          </div>
        ) : null}
        {workspace.map(item)}
        <div className="px-2.5 pb-1 pt-4 text-label font-medium text-fg-muted">
          Account
        </div>
        {account.map(item)}
      </nav>
      <nav
        aria-label="Settings sections"
        className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border-subtle px-4 py-2 [scrollbar-width:none] md:px-6 lg:hidden"
      >
        {[...workspace, ...account].map((i) => {
          const on = i.match(pathname)
          return (
            <Chip
              key={i.label}
              variant="nav"
              current={on}
              render={<Link {...i.link} />}
            >
              {i.label}
            </Chip>
          )
        })}
      </nav>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
