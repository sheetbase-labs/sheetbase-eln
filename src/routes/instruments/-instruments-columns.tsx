/**
 * The Instruments registry's columns: what each row of the instrument table
 * shows, given the calibration, intake and naming evidence its cells read.
 */
import { Link } from '@tanstack/react-router'

import { Dot } from '#/components/ui/status'
import { ObjectLink } from '#/components/ui/object-link'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import {
  intakeHealth,
  intakeMethodLabel,
  isOutOfService,
} from '#/components/instruments/instruments-data'
import type {
  InstrumentCalibrationRow,
  InstrumentLastImport,
  InstrumentRow,
} from '#/components/instruments/instruments-data'
import { calibrationState } from '#/components/instruments/calibration-standing'
import { instrumentTypeLabel } from '#/lib/instrument-type-label'
import type { useUserNames } from '#/lib/user-names'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

/** The registry's columns, given the evidence their cells read. */
export function instrumentColumns(evidence: {
  latest: Map<string, InstrumentCalibrationRow> | undefined
  lastImports: Map<string, InstrumentLastImport> | undefined
  readiness: Map<string, boolean> | undefined
  parserReadyKnown: boolean
  names: ReturnType<typeof useUserNames>
  openInstrument: (instrument: InstrumentRow, event: React.MouseEvent) => void
}): RegistryColumn<InstrumentRow>[] {
  const { names, openInstrument } = evidence

  const latest = evidence.latest ?? new Map<string, InstrumentCalibrationRow>()

  const lastImports =
    evidence.lastImports ?? new Map<string, InstrumentLastImport>()

  const calFor = (id: string) => calibrationState(latest.get(id)?.dueAt ?? null)

  const healthFor = (instrument: InstrumentRow) =>
    intakeHealth(instrument.intakeMethod, {
      parserReady: evidence.parserReadyKnown
        ? (evidence.readiness?.get(instrument.id) ?? false)
        : undefined,
      lastImport: lastImports.get(instrument.id) ?? null,
    })

  return [
    {
      id: 'identifier',
      header: 'ID',
      accessorFn: (i) => i.displayId ?? i.id.slice(0, 8),
      enableHiding: false,
      cell: ({ row }) => (
        <ObjectLink
          kind="instrument"
          id={row.original.id}
          identifier={row.original.displayId ?? row.original.id.slice(0, 8)}
        />
      ),
    },
    {
      id: 'name',
      header: t('library.instruments.list.nameAndType'),
      accessorFn: (i) => i.name,
      meta: {
        exportValue: (i: InstrumentRow) =>
          `${i.name} (${instrumentTypeLabel(i.instrumentType)})`,
      },
      // The grid zeroes a cell's own vertical padding, so a two-line cell
      // carries its line height and padding on its content instead. The
      // bespoke body's two-line rows were 46px, and stay 46px.
      cell: ({ row }) => (
        <span className="block py-1.5 leading-[17px]">
          <span className="block">
            <Link
              to="/instruments/$instrumentId"
              params={{ instrumentId: row.original.id }}
              onClick={(event) => openInstrument(row.original, event)}
            >
              {row.original.name}
            </Link>
          </span>
          <span className="block text-label text-fg-muted">
            {instrumentTypeLabel(row.original.instrumentType)}
            {isOutOfService(row.original) ? (
              <>
                {' · '}
                <span className="text-warning-text">
                  {t('library.instruments.outOfService.status')}
                </span>
              </>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      id: 'model',
      header: t('library.instruments.list.makeAndModel'),
      accessorFn: (i) => i.model ?? undefined,
      meta: {
        cellClassName: 'max-w-[180px]',
        exportValue: (i: InstrumentRow) =>
          [i.vendor, i.model].filter(Boolean).join(' '),
      },
      cell: ({ row }) => (
        <span className="block py-1.5 leading-[17px]">
          <span className="block truncate">{row.original.model ?? '—'}</span>
          <span className="block truncate text-label text-fg-muted">
            {row.original.vendor ?? '—'}
          </span>
        </span>
      ),
    },
    {
      id: 'location',
      header: 'Location',
      accessorFn: (i) => i.location ?? undefined,
      cell: ({ row }) => row.original.location ?? '—',
    },
    {
      id: 'intake',
      header: t('library.instruments.list.howDataGetsIn'),
      accessorFn: (i) => intakeMethodLabel(i.intakeMethod),
      cell: ({ row }) => {
        const health = healthFor(row.original)

        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Dot tone={health.tone} />
            <span>{intakeMethodLabel(row.original.intakeMethod)}</span>
            {health.tone === 'bad' || health.tone === 'warn' ? (
              <span
                className={cn(
                  'text-fg-muted',
                  health.tone === 'bad' && 'text-danger-text',
                  health.tone === 'warn' && 'text-warning-text',
                )}
              >
                · {health.label}
              </span>
            ) : null}
          </span>
        )
      },
    },
    {
      id: 'calibration',
      header: t('library.instruments.list.calibrationDue'),
      // Ordered by the due date, soonest first; no date sorts last.
      accessorFn: (i) => latest.get(i.id)?.dueAt ?? undefined,
      meta: {
        cellClassName: 'py-1.5 leading-[17px]',
        exportValue: (i: InstrumentRow) => latest.get(i.id)?.dueAt ?? '',
      },
      cell: ({ row }) => {
        const c = calFor(row.original.id)

        return (
          <span
            // The date is in the tooltip; the cell keeps the part that matters
            // ("40 d overdue") so the column fits a third-width pane.
            title={c.label}
            className={cn(
              'whitespace-nowrap',
              c.tone === 'bad' && 'text-danger-text',
              c.tone === 'warn' && 'text-warning-text',
            )}
          >
            {c.label.split(' · ').at(-1)}
          </span>
        )
      },
    },
    {
      id: 'owner',
      header: 'Owner',
      accessorFn: (i) => (i.ownerId ? names.userLabel(i.ownerId) : undefined),
      // The grid owns cell padding (`px-2.5` on every cell), so a column's
      // own trailing space has to be requested explicitly — this column was
      // the last one in the table before the swap and carried `pr-6`.
      meta: {
        headerClassName: 'pr-6! hide-in-narrow-pane',
        cellClassName: 'pr-6! hide-in-narrow-pane',
      },
      cell: ({ row }) =>
        row.original.ownerId ? names.userLabel(row.original.ownerId) : '—',
    },
  ]
}
