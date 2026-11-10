import { createFileRoute } from '@tanstack/react-router'

import { PluginPage } from '#/components/extensions/plugin-page'

/** A page a plugin adds to Settings → Workspace. */
export const Route = createFileRoute(
  '/settings/workspace/plugin-pages/$key/$id',
)({ component: PluginSettingsPage })

function PluginSettingsPage() {
  const { key, id } = Route.useParams()

  return <PluginPage extensionKey={key} id={id} kind="settings-pages" />
}
