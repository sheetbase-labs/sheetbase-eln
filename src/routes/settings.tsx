import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
} from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'

import { cn } from '#/lib/utils'

/** UI port (roadmap-4/ui-app3): the settings shell. Sections are grouped
 * workspace / account exactly as app-3, and the nav lists only routes that
 * exist so no link 404s. */
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

type Item = {
  label: string
  link: LinkProps
  match: (path: string) => boolean
}

const workspace: Item[] = [
  {
    label: 'General',
    link: { to: '/settings' },
    match: (p) => p === '/settings' || p === '/settings/',
  },
  {
    label: 'Members and roles',
    link: { to: '/settings/members' },
    match: (p) => p.startsWith('/settings/members'),
  },
  {
    label: 'Integrations',
    link: { to: '/settings/integrations' },
    match: (p) => p.startsWith('/settings/integrations'),
  },
  {
    label: 'Project access',
    link: { to: '/settings/access' },
    match: (p) => p.startsWith('/settings/access'),
  },
  {
    label: 'Audit and retention',
    link: { to: '/settings/audit' },
    match: (p) => p.startsWith('/settings/audit'),
  },
  {
    label: 'API and SDK',
    link: { to: '/settings/api' },
    match: (p) => p.startsWith('/settings/api'),
  },
]

const account: Item[] = [
  {
    label: 'Profile',
    link: { to: '/settings/profile' },
    match: (p) => p.startsWith('/settings/profile'),
  },
  {
    label: 'Notifications',
    link: { to: '/settings/notifications' },
    match: (p) => p.startsWith('/settings/notifications'),
  },
]

function SettingsLayout() {
  const { pathname } = useLocation()
  const item = (i: Item) => {
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
        <div className="px-2.5 pb-1 pt-2 text-label font-medium text-fg-muted">
          Workspace
        </div>
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
            <Link
              key={i.label}
              {...i.link}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border border-border px-3 text-label text-fg no-underline hover:bg-surface-hover hover:text-fg hover:no-underline max-md:h-9',
                on &&
                  'border-selection-border bg-selection font-medium hover:bg-selection',
              )}
            >
              {i.label}
            </Link>
          )
        })}
      </nav>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
