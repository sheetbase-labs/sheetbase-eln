/**
 * The Snapshots tab's list columns: what each row of `dataset_version_list`
 * shows, given the snapshot the inspector currently holds.
 */
import { t } from '#/copy'
import { Status } from '#/components/ui/status'
import { rightAligned } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import {
  describeSnapshotKeeping,
  isSnapshotTombstone,
} from '#/components/datasets/snapshot-data'
import type { SnapshotVersion } from '#/components/datasets/snapshot-data'
import { stickyCell, stickyHead } from '#/components/inventory/list'
import { cn } from '#/lib/utils'
import { formatDate } from '#/lib/format-date'

/** The registry's columns, highlighting the snapshot the inspector shows. */
export function snapshotColumns(
  current: SnapshotVersion | undefined,
): RegistryColumn<SnapshotVersion>[] {
  return [
    {
      id: 'snapshot',
      header: t('data.datasetSnapshots.snapshot2'),
      cell: ({ row }) => (
        <span
          className={cn(
            'mono',
            row.original.id === current?.id && 'font-semibold',
          )}
        >
          {row.original.label}
        </span>
      ),
      meta: {
        headerClassName: stickyHead,
        cellClassName: stickyCell,
      },
    },
    {
      id: 'saved',
      header: t('common.states.saved'),
      cell: ({ row }) => formatDate(row.original.createdAt, { time: true }),
    },
    {
      id: 'rows',
      header: t('data.datasetSnapshots.rows'),
      cell: ({ row }) =>
        isSnapshotTombstone(row.original) ? (
          <span className="text-fg-muted">
            {t('data.datasetSnapshots.removed')}
          </span>
        ) : (
          row.original.rowCount
        ),
      meta: rightAligned<SnapshotVersion>().meta,
    },
    {
      id: 'revision',
      header: t('data.datasetSnapshots.sourceRevision'),
      cell: ({ row }) => row.original.sourceDatasetRevision,
      meta: { cellClassName: 'num' },
    },
    {
      id: 'retention',
      header: t('data.datasetSnapshots.retention'),
      cell: ({ row }) => {
        const view = describeSnapshotKeeping(row.original)

        return view ? <Status tone={view.tone}>{view.label}</Status> : null
      },
    },
  ]
}
