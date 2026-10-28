'use client'

/**
 * EXP-05.2 — the unsynced-changes surface: a marker for the cell or block an
 * edit belongs to, and the inspector's list of everything waiting to sync
 * (canvas/NbOffline.dc.html). Both read the same `OfflineEdit`s the device
 * store holds; neither invents an edit that is not stored, and an empty list
 * says so rather than implying work.
 */

import { cn } from '#/lib/utils'
import { Row, RowList } from '#/components/v3/ui/row'
import type { OfflineEdit } from '#/lib/offline/store'
import {
  describeOfflineEdit,
  formatClockTime,
} from '#/components/offline/offline-edits'
import type { OfflineEditDescription } from '#/components/offline/offline-edits'

/**
 * "Saved on this device, not yet synced" — the grey mark and dotted
 * underline the design uses on an affected cell or block. `label` is the
 * visible text; the full sentence is available to assistive tech.
 */
export function UnsyncedMark({
  label = 'Not synced yet',
  detail = 'Saved on this device; it will sync when you reconnect.',
  className,
}: {
  label?: string
  detail?: string
  className?: string
}) {
  return (
    <span
      data-unsynced-mark
      aria-label={`${label}. ${detail}`}
      className={cn(
        'inline-flex items-center gap-1 text-label text-fg-muted',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-fg-muted/60"
      />
      <span className="underline decoration-dotted decoration-fg-muted/70 underline-offset-2">
        {label}
      </span>
    </span>
  )
}

/**
 * The inspector's "Unsynced changes" list. Presentational: it renders the
 * edits it is given (or a description override per edit) and nothing else.
 */
export function UnsyncedChangesList({
  edits,
  describe = describeOfflineEdit,
  className,
}: {
  edits: readonly OfflineEdit[]
  /** Override the description, e.g. to name the block or column. */
  describe?: (edit: OfflineEdit) => OfflineEditDescription
  className?: string
}) {
  return (
    <section
      data-unsynced-changes
      aria-label="Unsynced changes"
      className={cn('space-y-2', className)}
    >
      <h3 className="flex items-baseline gap-1.5 text-label font-medium text-fg">
        Unsynced changes
        <span className="tabular-nums font-normal text-fg-muted">
          {edits.length}
        </span>
      </h3>
      {edits.length === 0 ? (
        <p className="text-label text-fg-muted">
          Nothing is waiting. Every edit is saved.
        </p>
      ) : (
        <RowList className="gap-1.5">
          {edits.map((edit) => {
            const description = describe(edit)
            return (
              <Row
                key={edit.id}
                data-unsynced-edit
                leading={
                  <span className="tabular-nums text-fg-muted">
                    {formatClockTime(description.at)}
                  </span>
                }
                title={description.title}
                meta={description.detail}
              />
            )
          })}
        </RowList>
      )}
    </section>
  )
}
