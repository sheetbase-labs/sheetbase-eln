import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
} from '@tanstack/react-router'

import { cn } from '#/lib/utils'
import {
  canOpenSettingsItem,
  settingsItemForPath,
  settingsNavForRole,
} from '#/components/v3/settings/settings-nav'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Notice } from '#/components/v3/ui/alert'
import { SettingsHeader } from '#/components/v3/settings/settings-page'
import { Tabs } from '#/components/v3/ui/tabs'
import type { SettingsNavItem } from '#/components/v3/settings/settings-nav'
import { settingsAccessOf } from '#/lib/settings-access'
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
  const role = context.workspace?.role
  const access = settingsAccessOf(context.workspace)
  const { workspace, account } = settingsNavForRole(role, access)
  const current = settingsItemForPath(pathname)
  const allowed = !current || canOpenSettingsItem(current, role, access)
  // A section opened through its area at "view" is read-only; one a role may
  // always open (their own signature) is not.
  const viewOnly =
    allowed &&
    current?.area != null &&
    access[current.area] === 'view' &&
    !(role && current.alwaysFor?.includes(role))
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
        {!allowed ? (
          <>
            <SettingsHeader title={current.label} />
            <div className="px-4 md:px-6">
              <EmptyState
                icon="lock"
                title="Your role can’t open this section"
                description="A workspace admin chooses which roles can open each settings section."
                action={
                  <Button
                    nativeButton={false}
                    render={<Link to="/settings/profile" />}
                  >
                    Open your profile settings
                  </Button>
                }
              />
            </div>
          </>
        ) : viewOnly ? (
          <>
            <div className="px-4 pt-3 md:px-6">
              <Notice>
                You can view these settings. Your role can’t change them.
              </Notice>
            </div>
            {/* A disabled fieldset turns every control inside it read-only. */}
            <fieldset
              disabled
              className="m-0 flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0"
            >
              <Outlet />
            </fieldset>
          </>
        ) : (
          <Outlet />
        )}
      </div>
    </div>
  )
}
