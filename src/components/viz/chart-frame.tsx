import * as React from 'react'
import { Camera, Download, Expand, MoreHorizontal, Radio } from 'lucide-react'

import { cn } from '#/lib/utils'
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
} from '#/components/ui'

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
  actions?: React.ReactNode
  loading?: boolean
  children?: React.ReactNode
  className?: string
  /** When true, the title is rendered by the parent (e.g. NotebookBlock)
   * and ChartFrame suppresses its own visual title. The title is still
   * used for the figure's aria-labelledby. */
  hideTitle?: boolean
}

export function ChartFrame({
  title,
  subtitle,
  provenance,
  mode = 'live',
  alt,
  legend,
  actions,
  loading = false,
  children,
  className,
  hideTitle = false,
}: ChartFrameProps) {
  const titleId = React.useId()
  const altId = React.useId()

  return (
    <figure
      className={cn('rounded-lg border bg-card shadow-xs', className)}
      role="figure"
      aria-labelledby={hideTitle ? undefined : titleId}
      aria-describedby={alt ? altId : undefined}
    >
      <figcaption className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {hideTitle ? null : (
              <h3 id={titleId} className="truncate text-sm font-semibold">
                {title}
              </h3>
            )}
            {mode === 'live' ? (
              <Badge variant="success" className="shrink-0">
                <Radio className="size-3" aria-hidden="true" />
                Live
              </Badge>
            ) : (
              <Badge variant="outline" className="shrink-0">
                <Camera className="size-3" aria-hidden="true" />
                Snapshot
              </Badge>
            )}
          </div>
          {subtitle ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {actions}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Download chart"
            disabled={loading}
          >
            <Download />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Expand chart"
            disabled={loading}
          >
            <Expand />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Chart actions"
                disabled={loading}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled>Open in analysis</DropdownMenuItem>
              <DropdownMenuItem disabled>Copy snapshot link</DropdownMenuItem>
              <DropdownMenuItem disabled>Export data</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </figcaption>

      <div className="p-4">
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
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          {provenance}
        </p>
      ) : null}

      {legend ? <div className="border-t px-4 py-3">{legend}</div> : null}
    </figure>
  )
}
