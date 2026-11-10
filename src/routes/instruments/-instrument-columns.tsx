import { Link } from '@tanstack/react-router'

import { Progress } from '#/components/ui/progress'
import { Status } from '#/components/ui/status'
import { Button } from '#/components/ui/button'
import { rightAligned } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import {
  formatInstrumentDay,
  runStatus,
} from '#/components/instruments/instruments-data'
import type {
  InstrumentCalibrationRow,
  InstrumentRunRow,
} from '#/components/instruments/instruments-data'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'

/** LAB-06.2 — one person's qualification to run an instrument, as
 * `instrument_qualification_list` reports it. */
export interface QualificationRow {
  user_id: string
  user_name: string | null
  valid_until: string
  current: boolean
  qualified_for: string | null
}

/** The calibration history's columns. */
export function calibrationColumnsOf(
  userLabel: (userId: string) => string,
): RegistryColumn<InstrumentCalibrationRow>[] {
  return [
    {
      id: 'performed',
      header: 'Performed',
      cell: ({ row }) => (
        <span className="mono">
          {formatInstrumentDay(row.original.performedAt)}
        </span>
      ),
    },
    {
      id: 'due',
      header: 'Due',
      cell: ({ row }) => (
        <span className="mono">{formatInstrumentDay(row.original.dueAt)}</span>
      ),
    },
    {
      id: 'by',
      header: 'By',
      cell: ({ row }) =>
        row.original.performedByUserId
          ? userLabel(row.original.performedByUserId)
          : '—',
    },
    {
      id: 'certificate',
      header: 'Certificate',
      cell: ({ row }) =>
        row.original.certificateFileId
          ? 'Attached'
          : t('library.instruments.record.noneAttached'),
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'notes',
      header: 'Notes',
      cell: ({ row }) => row.original.notes ?? '—',
      meta: { cellClassName: 'text-fg-muted' },
    },
  ]
}

/** The run queue's columns. */
export function runColumnsOf(): RegistryColumn<InstrumentRunRow>[] {
  return [
    {
      id: 'run',
      header: 'Run',
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const run = runStatus(row.original.status)

        return <Status tone={run.tone}>{run.label}</Status>
      },
    },
    {
      id: 'progress',
      header: 'Progress',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Progress
            label={t('library.instruments.record.progressFor', {
              name: row.original.name,
            })}
            value={row.original.progressPercent}
            valueText={`${row.original.progressPercent}%`}
            className="w-20"
          />
          <span className="text-label text-fg-muted">
            {row.original.progressPercent}%
          </span>
        </div>
      ),
      meta: rightAligned<InstrumentRunRow>().meta,
    },
    {
      id: 'samples',
      header: t('library.instruments.record.runSamples'),
      cell: ({ row }) =>
        row.original.sampleCount > 0 ? row.original.sampleCount : '—',
      meta: rightAligned<InstrumentRunRow>().meta,
    },
    {
      id: 'experiment',
      header: t('library.instruments.record.runExperiment'),
      cell: ({ row }) =>
        row.original.experiment ? (
          <Link
            to="/experiments/$expId"
            params={{ expId: row.original.experiment.identifier }}
            className="mono hover:underline"
          >
            {row.original.experiment.identifier}
          </Link>
        ) : (
          '—'
        ),
    },
    {
      id: 'dataset',
      header: t('library.instruments.record.runDataset'),
      cell: ({ row }) =>
        row.original.dataset ? (
          <Link
            to="/datasets/$datasetId"
            params={{ datasetId: row.original.dataset.id }}
            className="hover:underline"
            title={row.original.dataset.name}
          >
            <span className="mono">
              {row.original.dataset.displayId ?? row.original.dataset.name}
            </span>
          </Link>
        ) : (
          '—'
        ),
    },
    {
      id: 'started',
      header: 'Started',
      cell: ({ row }) =>
        row.original.startedAt
          ? formatDate(row.original.startedAt, { time: true })
          : '—',
      meta: { cellClassName: 'text-fg-muted' },
    },
  ]
}

/** The qualification table's columns; the revoke action is owner-only. */
export function qualificationColumnsOf({
  canQualify,
  onRevoke,
  personLabel,
}: {
  canQualify: boolean
  onRevoke: (row: QualificationRow) => void
  personLabel: (row: QualificationRow) => string
}): RegistryColumn<QualificationRow>[] {
  return [
    {
      id: 'person',
      header: 'Person',
      cell: ({ row }) => personLabel(row.original),
    },
    {
      id: 'validUntil',
      header: t('library.instruments.record.validUntil'),
      cell: ({ row }) => (
        <span className="mono">
          {formatInstrumentDay(row.original.valid_until)}
        </span>
      ),
    },
    {
      id: 'state',
      header: 'State',
      cell: ({ row }) => (
        <Status tone={row.original.current ? 'ok' : 'bad'}>
          {row.original.current
            ? t('library.instruments.record.current')
            : t('library.instruments.record.expired')}
        </Status>
      ),
    },
    ...(canQualify
      ? [
          {
            id: 'actions',
            header: () => (
              <span className="sr-only">
                {t('library.instruments.record.actions')}
              </span>
            ),
            cell: ({ row }: { row: { original: QualificationRow } }) => (
              <Button
                size="sm"
                variant="danger"
                onClick={() => onRevoke(row.original)}
              >
                {t('library.instruments.record.revoke')}
              </Button>
            ),
            meta: rightAligned<QualificationRow>().meta,
          } satisfies RegistryColumn<QualificationRow>,
        ]
      : []),
  ]
}
