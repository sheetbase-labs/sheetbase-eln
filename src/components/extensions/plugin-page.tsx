/**
 * A page a plugin draws itself: in the sidebar (`pages`) or in Settings
 * (`settings-pages`). The plugin's bundle fills the space under the page
 * header, in the sandboxed frame; if the plugin was switched off, removed or no
 * longer offers the page, the page says so and offers a way back.
 */
import { Link } from '@tanstack/react-router'

import { EmptyState } from '#/components/ui/empty-state'
import { PageHeader } from '#/components/ui/layout'
import { Skeleton } from '#/components/ui/skeleton'
import { SettingsHeader } from '#/components/settings/settings-page'
import { t } from '#/copy'
import { PluginFrame } from './plugin-frame'
import { operationAccess, usePluginPoints } from './use-plugin-points'

export function PluginPage({
  extensionKey,
  id,
  kind,
}: {
  extensionKey: string
  id: string
  kind: 'pages' | 'settings-pages'
}) {
  const points = usePluginPoints()
  const list = kind === 'pages' ? points.pages : points.settingsPages
  const item = list.find((p) => p.extensionKey === extensionKey && p.id === id)
  const Header = kind === 'pages' ? PageHeader : SettingsHeader
  if (points.isLoading)
    return (
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  if (!item) {
    const known = points.installed.get(extensionKey)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Header title={known?.name ?? extensionKey} />
        <div className="p-6">
          <EmptyState
            title={t('plugins.page.goneTitle')}
            description={t('plugins.page.goneBody')}
            action={
              <Link to="/" className="text-link">
                {t('plugins.page.goHome')}
              </Link>
            }
          />
        </div>
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {kind === 'pages' ? (
        <PageHeader
          title={item.declaration.title}
          meta={t('plugins.screen.from', { plugin: item.extensionName })}
        />
      ) : (
        <SettingsHeader title={item.declaration.title}>
          {t('plugins.screen.from', { plugin: item.extensionName })}
        </SettingsHeader>
      )}
      <PluginFrame
        key={`${item.extensionKey}/${item.id}`}
        extensionKey={item.extensionKey}
        pluginName={item.extensionName}
        point={kind}
        itemId={item.id}
        title={item.declaration.title}
        context={{ page: item.id }}
        operations={operationAccess(points, item.extensionKey)}
        fill
        persist={`${item.extensionKey}/${kind}/${item.id}`}
        className="min-h-[480px] flex-1"
      />
    </div>
  )
}
