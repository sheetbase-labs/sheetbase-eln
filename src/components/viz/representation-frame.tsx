import * as React from 'react'

import { t } from '#/copy'
import { cn } from '#/lib/utils'
import { Badge } from '#/components/v3/ui/badge'
import { Icon } from '#/components/v3/icons'
import type { RepresentationHandle } from '#/lib/representations'

/**
 * VIEW-01 — shared embedding chrome for scientific representations.
 *
 * `RepresentationFrame` owns the generic chrome (title, source/version
 * badge, frozen-vs-live badge, error state) and leaves the kind-specific
 * rendering to its children, so it never ties to a chart library, plate
 * grid, analysis table or sheet surface. Kind renderers plug in as children;
 * permission enforcement stays with RLS/RPCs — the badges display source
 * identity only.
 *
 * Adopted first by the chart block preview; other embed sites migrate in
 * VIEW-02..04.
 */

export interface RepresentationFrameProps {
  title: string
  handle: RepresentationHandle
  loading?: boolean
  /** When set, the frame renders an error state instead of children. */
  error?: string | null
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}

function sourceBadgeText(handle: RepresentationHandle): string | null {
  const { datasetId, versionId, recordId } = handle.source
  if (datasetId) {
    return versionId
      ? t('data.representationFrame.datasetV', {
          slice: datasetId.slice(0, 8),
          slice2: versionId.slice(0, 8),
        })
      : t('data.representationFrame.dataset', { slice: datasetId.slice(0, 8) })
  }
  if (recordId)
    return t('data.representationFrame.record', { slice: recordId.slice(0, 8) })
  return null
}

export function RepresentationFrame({
  title,
  handle,
  loading = false,
  error = null,
  actions,
  children,
  className,
}: RepresentationFrameProps) {
  const frozen = handle.provenance.frozen
  const sourceBadge = sourceBadgeText(handle)
  const titleId = React.useId()
  // A frozen handle pinning exactly one Dataset Version surfaces the pin at
  // a glance (mirrors the chart preview's version subtitle); multi-source
  // affordances stay with the kind renderer.
  const versionLine =
    frozen && handle.source.versionId
      ? t('data.representationFrame.datasetVersion', {
          slice: handle.source.versionId.slice(0, 8),
        })
      : null

  return (
    <figure
      className={cn('rounded-lg border bg-surface shadow-xs', className)}
      role="figure"
      aria-labelledby={titleId}
    >
      <figcaption className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 id={titleId} className="truncate text-sm font-semibold">
              {title}
            </h3>
            {frozen ? (
              <Badge variant="kind" className="shrink-0">
                <Icon name="archive" size={12} aria-hidden="true" />
                {t('data.representationFrame.snapshot')}
              </Badge>
            ) : (
              <Badge variant="add" className="shrink-0">
                <Icon name="play" size={12} aria-hidden="true" />
                {t('data.representationFrame.live')}
              </Badge>
            )}
            {sourceBadge ? (
              <Badge variant="chg" className="shrink-0">
                <Icon name="database" size={12} aria-hidden="true" />
                {sourceBadge}
              </Badge>
            ) : null}
          </div>
          {versionLine ? (
            <p className="mt-0.5 truncate text-xs text-fg-muted">
              {versionLine}
            </p>
          ) : null}
          <p className="mt-0.5 truncate text-xs text-fg-muted">
            {handle.provenance.summary}
            {handle.readOnly ? null : t('data.representationFrame.editable')}
          </p>
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
        ) : null}
      </figcaption>

      <div className="p-4">
        {loading ? (
          <p className="text-sm text-fg-muted" aria-busy="true">
            {t('data.representationFrame.loadingRepresentation')}
          </p>
        ) : error ? (
          <p
            role="alert"
            className="flex items-start gap-2 text-sm text-danger-text"
          >
            <Icon
              name="warn"
              size={16}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            {error}
          </p>
        ) : (
          children
        )}
      </div>
    </figure>
  )
}
