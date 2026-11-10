/**
 * A notebook block that a plugin draws. The block keeps only which plugin
 * block it is and the state the screen last returned; the screen itself is
 * asked for each time, so a plugin update changes what every notebook shows.
 * When the plugin is off or removed the block says so and keeps its data.
 */

import { z } from 'zod'

import { t } from '#/copy'
import type { NotebookBlock } from '#/lib/notebook-data'
import { PluginScreen } from './plugin-screen'
import type { PluginScreenProps } from './plugin-screen'
import { operationAccess, usePluginPoints } from './use-plugin-points'

/** The stored payload of a plugin block: which plugin block, and its state. */
const storedPayloadSchema = z.object({
  plugin: z.string().optional().catch(undefined),
  block: z.string().optional().catch(undefined),
  state: z.json().optional().catch(undefined),
})

export function PluginBlockView({
  payload,
  recordId,
  blockId,
  onState,
  insertBelow,
}: {
  payload: NotebookBlock['payload']
  recordId?: string
  blockId?: string
  /** Given in the editor so the screen's state is kept with the block. */
  onState?: PluginScreenProps['onState']
  /** Put a block below this one; given in the editor. */
  insertBelow?: PluginScreenProps['insertBelow']
}) {
  const points = usePluginPoints()

  const body = storedPayloadSchema.parse(payload)

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
      context={{
        // Which plugin block this is, so a screen can find its own kind among
        // the notebook's blocks or add another.
        plugin: item.extensionKey,
        block: item.id,
        recordId: recordId ?? null,
        blockId: blockId ?? null,
        // No handler to keep state means the block is being read, not edited.
        readOnly: !onState,
      }}
      state={body.state}
      onState={onState}
      operations={operationAccess(points, item.extensionKey)}
      scopes={points.installed.get(item.extensionKey)?.scopes}
      insertBelow={insertBelow}
    />
  )
}
