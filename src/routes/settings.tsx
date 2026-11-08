import * as React from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
} from '@tanstack/react-router'

import { cn } from '#/lib/utils'
import { usePluginPoints } from '#/components/extensions/use-plugin-points'
import {
  settingsPlaces,
  canOpenSettingsItem,
  settingsItemForPath,
  settingsNavForRole,
} from '#/components/settings/settings-nav'
import type {
  SettingsNavItem,
  SettingsPlace,
} from '#/components/settings/settings-nav'
import { Button } from '#/components/ui/button'
import { Icon } from '#/components/icons'
import { EmptyState } from '#/components/ui/empty-state'
import { Notice } from '#/components/ui/alert'
import { SettingsHeader } from '#/components/settings/settings-page'
import { Tabs } from '#/components/ui/tabs'
import { settingsAccessOf } from '#/lib/settings-access'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { t } from '#/copy'

/** The settings shell. Sections sit in three places (Lab setup, Workspace,
 * Account), switched along the top, with the places' sections listed beside. SHELL-01.2: workspace administration sections are
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
  const pluginPages = usePluginPoints().settingsPages
  const nav = React.useMemo(() => {
    const base = settingsNavForRole(role, access)
    // Pages the lab's plugins add sit in Workspace, for the people who hold
    // General (the same people who manage plugins).
    const added: SettingsNavItem[] = pluginPages.map((page) => ({
      place: 'workspace',
      cluster: t('plugins.page.cluster'),
      label: page.declaration.title,
      link: {
        to: '/settings/workspace/plugin-pages/$key/$id',
        params: { key: page.extensionKey, id: page.id },
      },
      match: (path) =>
        path ===
        `/settings/workspace/plugin-pages/${page.extensionKey}/${page.id}`,
      area: 'general',
    }))
    return {
      ...base,
      workspace: [
        ...base.workspace,
        ...added.filter((item) => canOpenSettingsItem(item, role, access)),
      ],
    }
  }, [role, access, pluginPages])
  const current =
    settingsItemForPath(pathname) ??
    nav.workspace.find((item) => item.match(pathname))
  const place: SettingsPlace = current?.place ?? 'account'
  const places = settingsPlaces.filter((p) => nav[p.key].length > 0)
  const sections = nav[place]
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
        {String(i.link.to).startsWith('/settings') ? null : (
          <Icon
            name="arrowUpRight"
            size={12}
            className="ml-1 inline text-fg-muted"
          />
        )}
      </Link>
    )
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <Tabs
        mode="url"
        label={t('settings.page.settingsAria')}
        className="shrink-0 border-b border-border px-4 md:px-6"
        value={place}
        items={places.map((p) => ({
          key: p.key,
          label: p.label,
          // A place opens on its first section inside Settings; Models,
          // listed under Lab setup, opens its own page.
          link: (
            nav[p.key].find((i) => String(i.link.to).startsWith('/settings')) ??
            nav[p.key][0]
          ).link,
        }))}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        <nav
          aria-label={t('settings.page.settingsSections')}
          className="hidden w-[220px] shrink-0 flex-col gap-px overflow-y-auto border-r border-border-subtle px-3 py-4 lg:flex"
        >
          {sections.map((i, n) => (
            <div key={i.label} className="contents">
              {i.cluster && i.cluster !== sections[n - 1]?.cluster ? (
                <div
                  className={cn(
                    'px-2.5 pb-1 text-label font-medium text-fg-muted',
                    n === 0 ? 'pt-2' : 'pt-4',
                  )}
                >
                  {i.cluster}
                </div>
              ) : null}
              {item(i)}
            </div>
          ))}
        </nav>
        <Tabs
          mode="url"
          variant="chip"
          label={t('settings.page.settingsSections')}
          className="shrink-0 border-b border-border-subtle px-4 py-2 md:px-6 lg:hidden"
          // The nav's own item predicate decides the current section: a rail
          // item's `match` covers a subtree (`/settings/workspace/members` and
          // the pages under it), which no path comparison could restate.
          value={sections.find((i) => i.match(pathname))?.label}
          items={sections.map((i) => ({
            key: i.label,
            label: i.label,
            link: i.link,
          }))}
        />
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-auto max-md:pb-20">
          {!allowed ? (
            <>
              <SettingsHeader title={current.label} />
              <div className="px-4 md:px-6">
                <EmptyState
                  icon="lock"
                  title={t('settings.page.roleOpenSection')}
                  description={t(
                    'settings.page.workspaceAdminChoosesDescription',
                  )}
                  action={
                    <Button
                      nativeButton={false}
                      render={<Link to="/settings/account/profile" />}
                    >
                      {t('settings.page.openProfileSettings')}
                    </Button>
                  }
                />
              </div>
            </>
          ) : viewOnly ? (
            <>
              <div className="px-4 pt-3 md:px-6">
                <Notice>{t('settings.page.viewSettingsRole')}</Notice>
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
    </div>
  )
}
