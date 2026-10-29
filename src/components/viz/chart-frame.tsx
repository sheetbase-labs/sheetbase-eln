import * as React from 'react'
import { Expand, Minimize2 } from 'lucide-react'

import { t } from '#/copy'
import { cn } from '#/lib/utils'
import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import { Skeleton } from '#/components/v3/ui/skeleton'
import { Icon } from '#/components/v3/icons'

/**
 * ChartFrame — a reusable frame around any chart visualisation. It owns the
 * chrome (title, subtitle, provenance, live/snapshot state, legend,
 * accessible alternative, actions) and leaves the chart itself to its
 * children, so it never ties to a specific rendering library or sample data
 * (UI-006).
 *
 * Accessibility: `alt` provides a text alternative to the visual; when
 * provided it is rendered as an sr-only summary associated with the figure
 * via aria-labelledby/aria-describedby.
 */

export type ChartMode = 'live' | 'snapshot'

export interface ChartFrameProps {
  title: string
  subtitle?: string
  /** Where the data came from, e.g. "Source: Stability assay · 2025-07-14". */
  provenance?: string
  mode?: ChartMode
  /** Text alternative to the visual, for screen readers. */
  alt?: string
  legend?: React.ReactNode
  /** The figure's caption, set in the chart's publication controls. */
  caption?: string
  actions?: React.ReactNode
  loading?: boolean
  children?: React.ReactNode
  className?: string
  /** When true, the title is rendered by the parent (e.g. NotebookBlock)
   * and ChartFrame suppresses its own visual title. The title is still
   * used for the figure's aria-labelledby. */
  hideTitle?: boolean
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  /** Stretch the figure to its parent and give the plot the leftover height. */
  fill?: boolean
}

export function ChartFrame({
  title,
  subtitle,
  provenance,
  mode = 'live',
  alt,
  legend,
  caption,
  actions,
  loading = false,
  children,
  className,
  hideTitle = false,
  expanded = false,
  onExpandedChange,
  fill = false,
}: ChartFrameProps) {
  const titleId = React.useId()
  const altId = React.useId()

  return (
    <figure
      className={cn(
        'rounded-lg border bg-surface shadow-xs',
        fill && 'flex h-full min-h-0 flex-col overflow-hidden',
        className,
      )}
      role="figure"
      aria-labelledby={titleId}
      aria-describedby={alt ? altId : undefined}
    >
      {hideTitle ? (
        <h3 id={titleId} className="sr-only">
          {title}
        </h3>
      ) : (
        <figcaption className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 id={titleId} className="truncate text-sm font-semibold">
                {title}
              </h3>
              {mode === 'live' ? (
                <Badge variant="add" className="shrink-0">
                  <Icon name="play" size={12} aria-hidden="true" />
                  {t('data.chartFrame.live')}
                </Badge>
              ) : (
                <Badge variant="kind" className="shrink-0">
                  <Icon name="archive" size={12} aria-hidden="true" />
                  {t('data.chartFrame.snapshot')}
                </Badge>
              )}
            </div>
            {subtitle ? (
              <p className="mt-0.5 truncate text-xs text-fg-muted">
                {subtitle}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {actions}
            {onExpandedChange ? (
              <Button
                variant="quiet"
                size="icon"
                aria-label={
                  expanded
                    ? t('data.chartFrame.ariaContractChart')
                    : t('data.chartFrame.ariaExpandChart')
                }
                title={
                  expanded
                    ? t('data.chartFrame.ariaContractChart')
                    : t('data.chartFrame.ariaExpandChart')
                }
                disabled={loading}
                onClick={() => onExpandedChange(!expanded)}
              >
                {expanded ? <Minimize2 /> : <Expand />}
              </Button>
            ) : null}
          </div>
        </figcaption>
      )}

      <div
        className={cn(
          hideTitle || fill ? 'min-h-0 flex-1 overflow-hidden' : 'p-4',
          fill && 'flex flex-col',
          fill && !hideTitle && 'px-3 pb-2 pt-1',
          fill && hideTitle && 'h-full',
        )}
      >
        {loading ? (
          <div className="space-y-2" aria-busy="true" aria-live="polite">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          children
        )}
      </div>

      {alt ? (
        <p id={altId} className="sr-only">
          {alt}
        </p>
      ) : null}

      {provenance ? (
        <p className="border-t px-4 py-2 text-xs text-fg-muted">{provenance}</p>
      ) : null}

      {caption ? (
        <p
          className={cn(
            'm-0 shrink-0 whitespace-pre-line border-t px-4 text-label text-fg-muted',
            fill ? 'py-1.5' : 'py-3',
          )}
        >
          {caption}
        </p>
      ) : null}
      {legend ? (
        <div
          role="region"
          aria-label={t('data.chartFrame.ariaChartLegend')}
          tabIndex={fill ? 0 : undefined}
          className={cn(
            'shrink-0 border-t px-4',
            fill ? 'max-h-[25%] overflow-y-auto py-1.5' : 'py-3',
          )}
        >
          {legend}
        </div>
      ) : null}
    </figure>
  )
}
