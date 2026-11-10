import { Link } from '@tanstack/react-router'

import { Section } from '#/components/ui/layout'
import { TableBox } from '#/components/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { formatSampleEventDayTime } from '#/components/samples/sample-history'
import type { SampleEvent } from '#/lib/samples'
import type { RecordWire } from '#/lib/notebook-data'
import { t } from '#/copy'

import { formatVolume } from './-sample-details-data'

/** The withdrawal ledger: when, who, how much, why and what is left. */
export function WithdrawalsSection({
  withdrawals,
  purposes,
  userLabel,
  unit,
}: {
  withdrawals: SampleEvent[]
  purposes: Map<string, RecordWire> | undefined
  userLabel: (userId: string) => string
  unit: string | null
}) {
  const columns: RegistryColumn<SampleEvent>[] = [
    {
      id: 'when',
      header: t('library.samples.summary.when'),
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {formatSampleEventDayTime(row.original.createdAt)}
        </span>
      ),
    },
    {
      id: 'by',
      header: t('library.samples.summary.by'),
      cell: ({ row }) =>
        row.original.actorUserId
          ? userLabel(row.original.actorUserId)
          : t('library.samples.summary.system'),
    },
    {
      id: 'volume',
      header: t('library.samples.summary.volume'),
      cell: ({ row }) =>
        formatVolume(
          Math.abs(row.original.quantityDelta ?? 0),
          row.original.quantityUnit ?? unit,
        ),
      meta: rightAligned<SampleEvent>().meta,
    },
    {
      id: 'purpose',
      header: t('library.samples.summary.purpose'),
      cell: ({ row }) => (
        <WithdrawalPurpose
          notes={row.original.notes}
          recordId={row.original.purposeRecordId}
          purposes={purposes}
        />
      ),
      meta: { cellClassName: 'whitespace-normal' },
    },
    {
      id: 'remaining',
      header: t('library.samples.summary.remaining'),
      cell: ({ row }) =>
        formatVolume(row.original.quantityAfter, row.original.quantityUnit),
      meta: rightAligned<SampleEvent>().meta,
    },
  ]

  return (
    <Section
      title={t('library.samples.summary.withdrawals')}
      count={withdrawals.length}
    >
      {withdrawals.length ? (
        <TableBox>
          <RegistryGrid
            label={t('library.samples.summary.withdrawals')}
            rows={withdrawals}
            columns={columns}
            getRowId={(event) => event.id}
            selectable={false}
          />
        </TableBox>
      ) : (
        <p className="m-0 text-caption text-fg-muted">
          {t('library.samples.summary.noWithdrawalsRecorded')}
        </p>
      )}
    </Section>
  )
}

/**
 * The design's withdrawal Purpose cell: the free-text reason the operator
 * recorded, followed by the linked experiment or sample. Either half can be
 * absent, and the cell says so with an em dash when both are.
 */
function WithdrawalPurpose({
  notes,
  recordId,
  purposes,
}: {
  notes: string | null
  recordId: string | null
  purposes: Map<string, RecordWire> | undefined
}) {
  const record = recordId ? purposes?.get(recordId) : undefined

  if (!notes && !record) return <>—</>

  return (
    <>
      {notes}
      {notes && record ? ', ' : null}
      {record ? (
        record.kind === 'sample' ? (
          <Link
            to="/samples/$sampleId"
            params={{ sampleId: record.id }}
            className="mono text-link"
          >
            {record.identifier}
          </Link>
        ) : (
          <Link
            to="/experiments/$expId"
            params={{ expId: record.id }}
            className="mono text-link"
          >
            {record.identifier}
          </Link>
        )
      ) : null}
    </>
  )
}
