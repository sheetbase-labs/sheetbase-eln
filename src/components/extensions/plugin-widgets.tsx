/**
 * The cards plugins add to Home. Each is a sandboxed frame under a title that
 * says which plugin it is from; nothing renders when no plugin offers one.
 */
import { cn } from '#/lib/utils'
import { t } from '#/copy'
import { PluginFrame } from './plugin-frame'
import { operationAccess, usePluginPoints } from './use-plugin-points'

export function PluginWidgets({ className }: { className?: string }) {
  const points = usePluginPoints()

  if (points.dashboardWidgets.length === 0) return null

  return (
    <section
      aria-label={t('plugins.widgets.label')}
      className={cn(
        'grid grid-cols-1 gap-4 px-4 pb-8 md:grid-cols-2 md:px-6',
        className,
      )}
    >
      {points.dashboardWidgets.map((widget) => (
        <article
          key={`${widget.extensionKey}/${widget.id}`}
          className={cn(
            'flex min-w-0 flex-col rounded-lg border border-border bg-surface',
            widget.declaration.size === 'wide' && 'md:col-span-2',
          )}
        >
          <header className="flex items-baseline gap-2 border-b border-border-subtle px-3 py-2">
            <h2 className="m-0 text-section">{widget.declaration.title}</h2>
            <span className="text-label text-fg-muted">
              {t('plugins.screen.from', { plugin: widget.extensionName })}
            </span>
          </header>
          <PluginFrame
            extensionKey={widget.extensionKey}
            pluginName={widget.extensionName}
            point="dashboard-widgets"
            itemId={widget.id}
            title={widget.declaration.title}
            context={{ widget: widget.id }}
            operations={operationAccess(points, widget.extensionKey)}
            persist={`${widget.extensionKey}/widget/${widget.id}`}
            className="p-1"
          />
        </article>
      ))}
    </section>
  )
}
