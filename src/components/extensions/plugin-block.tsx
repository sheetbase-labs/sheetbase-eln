/**
 * A notebook block that a plugin draws. The block keeps only which plugin
 * block it is and the state the screen last returned; the screen itself is
 * asked for each time, so a plugin update changes what every notebook shows.
 * When the plugin is off or removed the block says so and keeps its data.
 */

import { t } from '#/copy'
import { PluginScreen } from './plugin-screen'
import { operationAccess, usePluginPoints } from './use-plugin-points'

export function PluginBlockView({
  payload,
  recordId,
  blockId,
  onState,
}: {
  payload: unknown
  recordId?: string
  blockId?: string
  /** Given in the editor so the screen's state is kept with the block. */
  onState?: (state: unknown) => void
}) {
  const points = usePluginPoints()
  const body = (payload ?? {}) as {
    plugin?: string
    block?: string
    state?: unknown
  }
  const item = points.blocks.find(
    (b) => b.extensionKey === body.plugin && b.id === body.block,
  )
  if (points.isLoading) return null
  if (!item) {
    const known = body.plugin ? points.installed.get(body.plugin) : undefined
    return (
      <p className="m-0 rounded-md border border-dashed border-border px-3 py-2 text-label text-fg-muted">
        {t('plugins.screen.pluginBlockGone', {
          plugin: known?.name ?? body.plugin ?? '',
        })}
      </p>
    )
  }
  const declaration = item.declaration
  return (
    <PluginScreen
      extensionKey={item.extensionKey}
      pluginName={item.extensionName}
      point="blocks"
      itemId={item.id}
      title={declaration.title}
      source={declaration.ui ? 'ui' : 'screen'}
      context={{ recordId: recordId ?? null, blockId: blockId ?? null }}
      state={body.state}
      onState={onState}
      operations={operationAccess(points, item.extensionKey)}
    />
  )
}
