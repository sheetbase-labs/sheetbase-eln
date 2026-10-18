import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
} from '@tanstack/react-router'

import { cn } from '#/lib/utils'
import { settingsNavForRole } from '#/components/v3/settings/settings-nav'
import { Tabs } from '#/components/v3/ui/tabs'
import type { SettingsNavItem } from '#/components/v3/settings/settings-nav'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** UI port (roadmap-4/ui-app3): the settings shell. Sections are grouped
 * workspace / account exactly as app-3, and the nav lists only routes that
 * exist so no link 404s. SHELL-01.2: workspace administration sections are
 * omitted for a role that cannot open them (see `settings-nav.ts`). */
export const Route = createFileRoute('/settings')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
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
      <Tabs
        mode="url"
        variant="chip"
        label="Settings sections"
        className="shrink-0 border-b border-border-subtle px-4 py-2 md:px-6 lg:hidden"
        // The nav's own item predicate decides the current section: a rail
        // item's `match` covers a subtree (`/settings/members` and the pages
        // under it), which no path comparison in the strip could restate.
        value={[...workspace, ...account].find((i) => i.match(pathname))?.label}
        items={[...workspace, ...account].map((i) => ({
          key: i.label,
          label: i.label,
          link: i.link,
        }))}
      />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
