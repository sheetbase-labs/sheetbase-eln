import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'

import { DescriptionList, Muted, Section } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Tooltip } from '#/components/ui/tooltip'
import { AddedFields } from '#/components/models/added-fields'
import {
  calibrationStatus,
  formatInstrumentDay,
} from '#/components/instruments/instruments-data'
import type {
  InstrumentCalibrationRow,
  InstrumentChange,
  InstrumentRow,
  InstrumentUsedBy,
} from '#/components/instruments/instruments-data'
import { t } from '#/copy'

/** The instrument's stored fields, with the calibration countdown. */
export function FieldsSection({
  instrument,
  userLabel,
  latest,
}: {
  instrument: InstrumentRow
  userLabel: (userId: string) => string
  latest: InstrumentCalibrationRow | null
}) {
  const i = instrument
  const status = calibrationStatus(latest?.dueAt ?? null)

  return (
    <Section
      className="border-t border-border pt-4"
      title={t('library.instruments.record.fields')}
    >
      <DescriptionList
        labelWidth={130}
        items={[
          ['Manufacturer', i.vendor ?? '—'],
          ['Model', i.model ?? '—'],
          ['Serial', <span className="mono">{i.serialNumber ?? '—'}</span>],
          ['Location', i.location ?? '—'],
          ['Owner', i.ownerId ? userLabel(i.ownerId) : '—'],
          [
            t('library.instruments.record.qualifiedFor'),
            i.qualifiedFor ?? t('library.instruments.record.notSet'),
          ],
          [
            t('library.instruments.record.calibrationDue'),
            latest ? (
              <Status tone={status.tone}>
                {formatInstrumentDay(latest.dueAt)}
              </Status>
            ) : (
              t('library.instruments.record.notRecorded')
            ),
          ],
        ]}
      />
    </Section>
  )
}

function UsedByGrid({ rows }: { rows: InstrumentUsedBy[] }) {
  const columns = useMemo<RegistryColumn<InstrumentUsedBy>[]>(
    () => [
      {
        id: 'name',
        header: t('library.instruments.record.usedByName'),
        accessorFn: (row) => row.label,
        enableHiding: false,
        cell: ({ row }) =>
          row.original.link ? (
            <Link
              to={row.original.link.to}
              params={{ datasetId: row.original.link.id }}
            >
              {row.original.label}
            </Link>
          ) : (
            row.original.label
          ),
      },
      {
        id: 'how',
        header: t('library.instruments.record.usedByHow'),
        accessorFn: (row) => row.how,
        cell: ({ row }) => (
          <span className="text-fg-muted">{row.original.how}</span>
        ),
      },
      {
        id: 'since',
        header: t('library.instruments.record.usedBySince'),
        accessorFn: (row) => row.since,
        meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {formatInstrumentDay(row.original.since)}
          </span>
        ),
      },
    ],
    [],
  )

  return (
    <RegistryGrid
      label={t('library.instruments.record.usedBy')}
      rows={rows}
      columns={columns}
      getRowId={(row) => row.key}
      selectable={false}
    />
  )
}

function HistoryGrid({
  entries,
  userLabel,
}: {
  entries: InstrumentChange[]
  userLabel: (userId: string) => string
}) {
  const columns = useMemo<RegistryColumn<InstrumentChange>[]>(
    () => [
      {
        id: 'when',
        header: t('library.instruments.record.when'),
        accessorFn: (entry) => entry.at,
        enableHiding: false,
        cell: ({ row }) => formatInstrumentDay(row.original.at),
      },
      {
        id: 'change',
        header: t('library.instruments.record.change'),
        accessorFn: (entry) => entry.changes.map((c) => c.label).join(', '),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.changes.length ? (
            <span className="flex min-w-0 items-baseline gap-3">
              {row.original.changes.map((c) => (
                <span key={c.label} className="whitespace-nowrap">
                  {c.label} <del className="text-fg-muted">{c.from ?? '—'}</del>{' '}
                  → <ins className="no-underline">{c.to ?? '—'}</ins>
                </span>
              ))}
            </span>
          ) : (
            t('library.instruments.record.registered')
          ),
      },
      {
        id: 'by',
        header: t('library.instruments.record.by'),
        accessorFn: (entry) =>
          entry.actorUserId ? userLabel(entry.actorUserId) : '',
        cell: ({ row }) =>
          row.original.actorUserId ? userLabel(row.original.actorUserId) : '—',
      },
    ],
    [userLabel],
  )

  return (
    <RegistryGrid
      label={t('library.instruments.record.changeHistory')}
      rows={entries}
      columns={columns}
      getRowId={(entry) => entry.id}
      selectable={false}
    />
  )
}

/** The datasets imported from this instrument. */
export function UsedBySection({ rows }: { rows: InstrumentUsedBy[] }) {
  return (
    <Section
      className="border-t border-border pt-4"
      title={t('library.instruments.record.usedBy')}
      count={rows.length}
    >
      {rows.length ? (
        <TableBox>
          <UsedByGrid rows={rows} />
        </TableBox>
      ) : (
        <Muted>
          {t('library.instruments.record.nothingHasBeenImportedFrom')}
        </Muted>
      )}
    </Section>
  )
}

/** Every change to the instrument's name, location and fields. */
export function HistorySection({
  entries,
  userLabel,
}: {
  entries: InstrumentChange[]
  userLabel: (userId: string) => string
}) {
  if (!entries.length) return null

  return (
    <Section
      className="border-t border-border pt-4"
      title={
        <Tooltip content="Renaming this instrument or moving it to another room updates every record that mentions it. Anything already signed keeps what it showed at the time.">
          <span tabIndex={0}>
            {t('library.instruments.record.changeHistory')}
          </span>
        </Tooltip>
      }
    >
      <TableBox>
        <HistoryGrid entries={entries} userLabel={userLabel} />
      </TableBox>
    </Section>
  )
}

/** The model's added fields, rendered as their own section. */
export function InstrumentAddedFields({
  instrumentId,
}: {
  instrumentId: string
}) {
  return (
    <AddedFields
      modelKey="instrument"
      objectId={instrumentId}
      variant="section"
      labelWidth={130}
    />
  )
}
