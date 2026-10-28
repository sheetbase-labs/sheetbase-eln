import { Link } from '@tanstack/react-router'

import { Dot } from '#/components/v3/ui/status'
import { Muted } from '#/components/v3/ui/layout'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import {
  calibrationStatus,
  formatInstrumentDay,
  intakeHealth,
  useInstruments,
  useLastImportsByInstrument,
  useLatestCalibrationsByInstrument,
  useParserReadinessByInstrument,
} from '#/components/v3/instruments/instruments-data'
import type { InstrumentRow } from '#/components/v3/instruments/instruments-data'
import { formatDate } from '#/lib/format-date'
import { cn } from '#/lib/utils'
import type { ParserSettingsRow } from '#/lib/parser-settings'

/**
 * The instruments board of Settings: each instrument in service, the parser
 * that reads its files, whether data can arrive, its calibration due date and
 * its last import. Picking a row narrows the parsers below to that
 * instrument's.
 */
export function InstrumentParserTable({
  parsers,
  selectedInstrumentId,
  onSelect,
}: {
  parsers: ParserSettingsRow[]
  selectedInstrumentId: string | null
  onSelect: (instrumentId: string | null) => void
}) {
  const instruments = useInstruments()
  const calibrations = useLatestCalibrationsByInstrument()
  const lastImports = useLastImportsByInstrument()
  const readiness = useParserReadinessByInstrument()
  const rows = (instruments.data ?? []).filter((i) => !i.retiredAt)
  const { rowSelection, onRowSelectionChange } = useRowFocus(
    selectedInstrumentId,
    onSelect,
  )

  const columns: RegistryColumn<InstrumentRow>[] = [
    {
      id: 'instrument',
      header: 'Instrument',
      cell: ({ row }) => (
        <Link
          to="/instruments/$instrumentId"
          params={{ instrumentId: row.original.id }}
          onClick={(event) => event.stopPropagation()}
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      id: 'parser',
      header: 'Parser',
      cell: ({ row }) => {
        const own = parsers.filter((p) => p.instrument_id === row.original.id)
        if (!own.length) return <span className="text-fg-muted">None</span>
        const names = own.map((p) => p.name).join(', ')
        return (
          <span className="block max-w-56 truncate" title={names}>
            {names}
          </span>
        )
      },
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const health = intakeHealth(row.original.intakeMethod, {
          parserReady: readiness.isSuccess
            ? (readiness.data.get(row.original.id) ?? false)
            : undefined,
          lastImport: lastImports.data?.get(row.original.id) ?? null,
        })
        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Dot tone={health.tone} />
            {health.label}
          </span>
        )
      },
    },
    {
      id: 'calibration',
      header: 'Calibration due',
      cell: ({ row }) => {
        const dueAt = calibrations.data?.get(row.original.id)?.dueAt ?? null
        const { tone, label } = calibrationStatus(dueAt)
        return (
          <span
            className={cn(
              'whitespace-nowrap',
              tone === 'bad' && 'text-danger-text',
              tone === 'warn' && 'text-warning-text',
            )}
            title={dueAt ? label : undefined}
          >
            {dueAt ? formatInstrumentDay(dueAt) : 'Not calibrated'}
          </span>
        )
      },
    },
    {
      id: 'lastImport',
      header: 'Last import',
      cell: ({ row }) => {
        const last = lastImports.data?.get(row.original.id)
        return last ? formatDate(last.createdAt) : '—'
      },
    },
  ]

  if (instruments.isLoading) return <Muted>Loading instruments…</Muted>
  if (!rows.length) return <Muted>No instruments are registered yet.</Muted>
  return (
    <TableBox>
      <RegistryGrid
        label="Instruments"
        rows={rows}
        columns={columns}
        getRowId={(instrument) => instrument.id}
        rowSelection={rowSelection}
        onRowSelectionChange={onRowSelectionChange}
      />
    </TableBox>
  )
}
