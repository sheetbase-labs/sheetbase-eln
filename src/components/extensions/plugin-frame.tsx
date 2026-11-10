/**
 * Hosts a plugin's UI bundle in a sandboxed frame.
 *
 * The frame has `sandbox="allow-scripts"` and no `allow-same-origin`, so it has
 * no cookies or storage and cannot read this page; the document is served with
 * a policy that allows no network (`ui-frame.ts`). Its only way out is the SDK's
 * `postMessage` channel, and `usePluginFrameLink` is the only listener: it
 * ignores any message that does not come from its own frame window, decodes it,
 * and answers only for the plugin the frame belongs to.
 *
 * - `call` runs one of the plugin's own operations as the person. A read runs
 *   straight away; an operation that changes something first asks the person,
 *   because the frame could press its own buttons.
 * - `state` is kept with the block (the caller decides how).
 * - `notify` shows a toast; `resize` sizes the frame.
 */
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import { Spinner } from '#/components/ui/spinner'
import { PluginTable } from './plugin-table'
import type { HostEnvironment } from './plugin-host'
import type { PluginFramePoint } from '#/lib/extensions/ui-points'
import { cn } from '#/lib/utils'
import { t } from '#/copy'
import { usePluginFrameLink } from './use-plugin-frame-link'
import type { PluginFrameLinkOptions } from './use-plugin-frame-link'
import type { PluginScreenContext } from './plugin-frame-protocol'

export { readTheme } from './plugin-frame-protocol'

export interface PluginFrameProps {
  extensionKey: string
  pluginName: string
  point: PluginFramePoint
  itemId: string
  title: string
  context: PluginScreenContext
  state?: unknown
  /** Access of each operation the plugin declares, so a write can be confirmed. */
  operations: Record<string, 'read' | 'write'>
  /** What the plugin's manifest declares it may reach (`permissions`); unlocks `sheetbase.host` calls. */
  scopes?: readonly string[]
  /** Put a block below this one, where the screen is in an editable notebook. */
  insertBelow?: HostEnvironment['insertBelow']
  /** The plugin's state, kept or passed on exactly as it arrived. */
  onState?: PluginFrameLinkOptions['onState']
  /** Messages the screen sends up by name: `value` (a field input), `section` (a report section). */
  onEmit?: PluginFrameLinkOptions['onEmit']
  /** Fill the space around the frame (a page) instead of growing with the content. */
  fill?: boolean
  /**
   * Keep what the screen saves with `setState` in this browser, under this
   * name, for the signed-in person: for a page, settings page or Home card,
   * which have no block to keep it with. Not shared with anyone else.
   */
  persist?: string
  className?: string
}

export function PluginFrame(props: PluginFrameProps) {
  const {
    extensionKey,
    pluginName,
    point,
    itemId,
    title,
    context,
    state,
    operations,
    scopes,
    insertBelow,
    onState,
    onEmit,
    fill,
    persist,
    className,
  } = props

  const { frame, ready, height, table, asking } = usePluginFrameLink({
    extensionKey,
    point,
    context,
    state,
    operations,
    scopes,
    insertBelow,
    onState,
    onEmit,
    persist,
  })

  return (
    <div
      className={cn(
        fill && !table && 'h-full',
        fill && table && 'overflow-y-auto',
        className,
      )}
    >
      <div className={cn('relative', fill && !table && 'h-full')}>
        {!ready ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner />
          </div>
        ) : null}
        <iframe
          ref={frame}
          title={t('plugins.screen.frameTitle', {
            name: title,
            plugin: pluginName,
          })}
          src={`/api/plugins/${extensionKey}/ui/${itemId}?point=${point}`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          loading="lazy"
          className="block w-full border-0 bg-transparent"
          style={{ height: fill && !table ? '100%' : height }}
        />
      </div>
      {table ? (
        <div className={cn(fill && 'px-6 pb-6')}>
          <PluginTable table={table} />
        </div>
      ) : null}
      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) asking?.decide(false)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('plugins.screen.askTitle', {
                plugin: pluginName,
                operation: asking?.operation ?? '',
              })}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {asking?.detail ? `${asking.detail} ` : ''}
              {t('plugins.screen.askBody')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('plugins.screen.askCancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction onClick={() => asking?.decide(true)}>
              {t('plugins.screen.askRun')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}
