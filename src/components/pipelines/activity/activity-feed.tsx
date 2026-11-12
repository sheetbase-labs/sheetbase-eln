import { useMemo } from 'react'

import { t } from '#/copy'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import type { ActivityEvent, ActivityKind } from './activity-events'

const WHAT: Record<ActivityKind, { label: () => string; tone: Tone }> = {
  created: {
    label: () => t('features.pipelineApprovals.activity.createdDraft'),
    tone: 'draft',
  },
  requested: {
    label: () => t('features.pipelineApprovals.activity.requested'),
    tone: 'review',
  },
  approved: {
    label: () => t('features.pipelineApprovals.activity.approvedEvent'),
    tone: 'ok',
  },
  returned: {
    label: () => t('features.pipelineApprovals.activity.returnedEvent'),
    tone: 'bad',
  },
  withdrawn: {
    label: () => t('features.pipelineApprovals.activity.withdrawnEvent'),
    tone: 'stored',
  },
  published: {
    label: () => t('features.pipelineApprovals.activity.publishedEvent'),
    tone: 'ok',
  },
  retired: {
    label: () => t('features.pipelineApprovals.activity.retiredEvent'),
    tone: 'none',
  },
}

/** The history of a pipeline's versions, one row to a thing that happened. */
export function ActivityFeed({
  events,
  actorLabel,
}: {
  events: ActivityEvent[]
  actorLabel: (id: string | null | undefined) => string
}) {
  const columns = useMemo<RegistryColumn<ActivityEvent>[]>(
    () => [
      {
        id: 'when',
        header: t('features.pipelineApprovals.activity.when'),
        accessorFn: (event) => event.at,
        enableHiding: false,
        cell: ({ row }) => formatNotebookDateTime(row.original.at),
      },
      {
        id: 'what',
        header: t('features.pipelineApprovals.activity.what'),
        accessorFn: (event) => WHAT[event.kind].label(),
        cell: ({ row }) => {
          const what = WHAT[row.original.kind]

          return <Status tone={what.tone}>{what.label()}</Status>
        },
      },
      {
        id: 'version',
        header: t('features.pipelineApprovals.activity.version'),
        accessorFn: (event) => event.version,
        cell: ({ row }) => (
          <span className="font-mono">v{row.original.version}</span>
        ),
      },
      {
        id: 'who',
        header: t('features.pipelineApprovals.activity.who'),
        accessorFn: (event) => event.actorId ?? '',
        // Read at render, so names that arrive after the rows still show.
        cell: ({ row }) => actorLabel(row.original.actorId),
      },
      {
        id: 'note',
        header: t('features.pipelineApprovals.activity.note'),
        accessorFn: (event) => event.note ?? '',
        cell: ({ row }) =>
          row.original.note ? (
            <span className="text-fg-muted">“{row.original.note}”</span>
          ) : null,
      },
    ],
    [actorLabel],
  )

  return (
    <TableBox>
      <RegistryGrid
        label={t('features.pipelineApprovals.activity.table')}
        rows={events}
        columns={columns}
        getRowId={(event) => event.id}
        selectable={false}
      />
    </TableBox>
  )
}
