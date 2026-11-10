import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Section } from '#/components/ui/layout'
import { ObjectLink } from '#/components/ui/object-link'
import { EmptyState } from '#/components/ui/empty-state'
import { TableBox } from '#/components/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import type { SampleActions } from '#/components/samples/quantity-actions'
import type { RecordWire } from '#/lib/notebook-data'
import { t } from '#/copy'

import type { UsageEntry } from './-sample-usage-data'

/**
 * The Usage table: withdrawals and live reservations in one grid, with the
 * Withdraw and Reserve buttons the sample frame owns, and the empty state
 * beside them.
 */
export function UsageSection({
  rows,
  rowCount,
  experimentById,
  actions,
  cancelling,
}: {
  rows: UsageEntry[]
  rowCount: number
  experimentById: Map<string, RecordWire>
  actions: SampleActions | null
  cancelling: boolean
}) {
  return (
    <Section
      title={t('library.samples.usage.usage')}
      count={rowCount}
      action={
        actions ? (
          <span className="flex flex-wrap justify-end gap-2">
            <Button size="sm" onClick={actions.openReserve}>
              {t('library.samples.usage.reserveVolume')}
            </Button>
            {actions.canWithdraw ? (
              <Button
                size="sm"
                variant="primary"
                onClick={actions.openWithdraw}
              >
                {t('library.samples.usage.withdrawVolume')}
              </Button>
            ) : null}
          </span>
        ) : null
      }
    >
      {rowCount ? (
        <TableBox>
          <RegistryGrid
            label={t('library.samples.usage.sampleUsage')}
            rows={rows}
            columns={usageColumns({ experimentById, cancelling })}
            getRowId={(row) => row.id}
            selectable={false}
          />
        </TableBox>
      ) : (
        <EmptyState
          className="py-2"
          icon="tube"
          title={t('library.samples.usage.notUsedYet')}
          description={t(
            'library.samples.usage.withdrawalsAndPlannedReservationsAppear',
          )}
        />
      )}
    </Section>
  )
}

/** The experiments that list this sample, linked from the sample's side. */
export function LinkedExperimentsSection({
  experiments,
}: {
  experiments: { id: string; identifier: string; title: string }[]
}) {
  return (
    <Section
      title={t('library.samples.usage.usedInExperiments')}
      count={experiments.length}
    >
      {experiments.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {experiments.map((experiment) => (
            <li key={experiment.id}>
              <ObjectLink
                kind="experiment"
                id={experiment.id}
                identifier={experiment.identifier}
              />{' '}
              {experiment.title}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          className="py-2"
          icon="flask"
          title={t('library.samples.usage.notLinkedToAnExperiment')}
          description={t('library.samples.usage.experimentsThatListThisSample')}
        />
      )}
    </Section>
  )
}

function usageColumns({
  experimentById,
  cancelling,
}: {
  experimentById: Map<string, RecordWire>
  cancelling: boolean
}): RegistryColumn<UsageEntry>[] {
  return [
    {
      id: 'experiment',
      header: t('library.samples.usage.experiment'),
      cell: ({ row }) => (
        <ExperimentLabel
          experimentId={row.original.experimentId}
          byId={experimentById}
        />
      ),
    },
    {
      id: 'title',
      header: t('library.samples.usage.title'),
      cell: ({ row }) => row.original.title,
      meta: { cellClassName: 'max-w-[20rem] whitespace-normal leading-[17px]' },
    },
    {
      id: 'purpose',
      header: t('library.samples.usage.purpose'),
      cell: ({ row }) => row.original.purpose,
      meta: { cellClassName: 'max-w-[16rem] whitespace-normal leading-[17px]' },
    },
    {
      id: 'volume',
      header: t('library.samples.usage.volume'),
      cell: ({ row }) => row.original.volume,
      meta: rightAligned<UsageEntry>().meta,
    },
    {
      id: 'by',
      header: t('library.samples.usage.by'),
      cell: ({ row }) => row.original.actor,
    },
    {
      id: 'when',
      header: t('library.samples.usage.when'),
      cell: ({ row }) => (
        <span className="text-fg-muted" title={row.original.whenTitle}>
          {row.original.when}
        </span>
      ),
      meta: {
        ...rightAligned<UsageEntry>().meta,
        cellClassName: 'text-right text-fg-muted',
      },
    },
    {
      id: 'actions',
      header: () => (
        <span className="sr-only">{t('library.samples.usage.actions')}</span>
      ),
      cell: ({ row }) =>
        row.original.cancel && !cancelling ? (
          <Button size="sm" onClick={row.original.cancel}>
            {t('common.actions.cancel')}
          </Button>
        ) : null,
      meta: { cellClassName: 'text-right' },
    },
  ]
}

function ExperimentLabel({
  experimentId,
  byId,
}: {
  experimentId: string | null
  byId: Map<string, RecordWire>
}) {
  if (!experimentId) return <span className="text-fg-muted">—</span>
  const experiment = byId.get(experimentId)

  if (!experiment) return <span className="text-fg-muted">—</span>

  return (
    <Link
      to="/experiments/$expId"
      params={{ expId: experiment.id }}
      className="mono text-link"
    >
      {experiment.identifier}
    </Link>
  )
}
