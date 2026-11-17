import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { TableBox } from '#/components/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { ObjectLink } from '#/components/ui/object-link'
import { formatQuantity } from '#/lib/format-quantity'
import {
  fetchSampleMeasurements,
  fetchSamplePlateResults,
  samplePlateResultsQueryKey,
} from '#/lib/samples'
import type { SampleMeasurement, SamplePlateResult } from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'
import { samplePath } from '#/lib/navigation'
import { rich, t } from '#/copy'
import { formatDate } from '#/lib/format-date'

/**
 * LAB-03: the sample Measurements tab is a read-only view of authoritative
 * values. Each value is aggregated from a Dataset row linked to the sample or
 * from an integration/QC result, and links back to its source row. Values
 * cannot be typed here; the standalone bench-reading surface lives elsewhere
 * (MOB-02).
 */
export const Route = createFileRoute('/samples/$sampleId/measurements')({
  component: MeasurementsTab,
})

function MeasurementsTab() {
  const { sampleId } = Route.useParams()

  const measurements = useQuery({
    queryKey: ['ui-port', 'sample-measurements', sampleId],
    queryFn: () => fetchSampleMeasurements(notebookDataClient, sampleId),
  })

  const rows = measurements.data ?? []

  const plateResults = useQuery({
    queryKey: samplePlateResultsQueryKey(sampleId),
    queryFn: () => fetchSamplePlateResults(notebookDataClient, sampleId),
  })

  const plateRows = plateResults.data ?? []

  const plateColumns: RegistryColumn<SamplePlateResult>[] = [
    {
      id: 'name',
      header: t('features.plateRuns.sampleResults.name'),
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      id: 'result',
      header: t('features.plateRuns.sampleResults.result'),
      cell: ({ row }) => (
        <span className="num font-medium">
          {formatQuantity(row.original.value)}
          {row.original.unit ? ` ${row.original.unit}` : ''}
        </span>
      ),
      meta: {
        ...rightAligned<SamplePlateResult>().meta,
        cellClassName: 'num text-right',
      },
    },
    {
      id: 'plate',
      header: t('features.plateRuns.sampleResults.plate'),
      cell: ({ row }) => (
        <ObjectLink kind="plate_run" id={row.original.plate_run_id}>
          {row.original.method?.split(' · ')[0] ?? row.original.plate_run_id}
        </ObjectLink>
      ),
    },
    {
      id: 'note',
      header: t('features.plateRuns.sampleResults.note'),
      cell: ({ row }) => row.original.notes ?? '—',
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'measured',
      header: t('features.plateRuns.sampleResults.measured'),
      cell: ({ row }) => formatDate(row.original.measured_at),
      meta: { cellClassName: 'num text-fg-muted' },
    },
  ]

  const columns: RegistryColumn<SampleMeasurement>[] = [
    {
      id: 'measurement',
      header: t('library.samples.measurements.measurement'),
      cell: ({ row }) => (
        <span className="font-medium">{row.original.measurement}</span>
      ),
    },
    {
      id: 'value',
      header: t('library.samples.measurements.value'),
      cell: ({ row }) => {
        const m = row.original

        return m.valueText ?? (m.value != null ? String(m.value) : '—')
      },
      meta: {
        ...rightAligned<SampleMeasurement>().meta,
        cellClassName: 'num text-right',
      },
    },
    {
      id: 'unit',
      header: t('library.samples.measurements.unit'),
      cell: ({ row }) => row.original.unit ?? '—',
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'method',
      header: t('library.samples.measurements.method'),
      cell: ({ row }) => row.original.method ?? '—',
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'source',
      header: t('library.samples.measurements.source'),
      cell: ({ row }) => <MeasurementSource measurement={row.original} />,
    },
    {
      id: 'result',
      header: t('library.samples.measurements.result'),
      cell: ({ row }) => row.original.result ?? '—',
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'measured',
      header: t('library.samples.measurements.measured'),
      cell: ({ row }) => formatDate(row.original.measuredAt),
      meta: { cellClassName: 'num text-fg-muted' },
    },
  ]

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <div className="flex items-center gap-2">
        <h2 className="text-section">
          {rich('library.samples.measurements.measurements', {
            rows: rows.length,
            span: (text) => <span className="num text-fg-muted">{text}</span>,
          })}
        </h2>
        <Button
          size="sm"
          className="ml-auto"
          nativeButton={false}
          render={
            <Link
              to="/readings/new"
              search={{ sample: sampleId, returnTo: samplePath(sampleId) }}
            />
          }
        >
          {t('library.samples.measurements.recordReading')}
        </Button>
      </div>
      <p className="m-0 -mt-4 text-label text-fg-muted">
        {t('library.samples.measurements.valuesComeFromDatasetsAnd')}
      </p>

      {rows.length ? (
        <TableBox>
          <RegistryGrid
            label={t('library.samples.measurements.measurements2')}
            rows={rows}
            columns={columns}
            getRowId={(m) => m.id}
            selectable={false}
          />
        </TableBox>
      ) : (
        <EmptyState
          className="py-2"
          title={t('library.samples.measurements.noMeasurementsYet')}
          description={t(
            'library.samples.measurements.valuesRecordedAgainstThisSample',
          )}
        />
      )}

      {plateRows.length ? (
        <>
          <h2 className="text-section">
            {t('features.plateRuns.sampleResults.title')}
          </h2>
          <p className="m-0 -mt-4 text-label text-fg-muted">
            {t('features.plateRuns.sampleResults.hint')}
          </p>
          <TableBox>
            <RegistryGrid
              label={t('features.plateRuns.sampleResults.title')}
              rows={plateRows}
              columns={plateColumns}
              getRowId={(m) => m.id}
              selectable={false}
            />
          </TableBox>
        </>
      ) : null}
    </div>
  )
}

/**
 * A source cell that always links back to where the value came from: the
 * Dataset row/field that produced it, or the instrument whose run recorded the
 * QC result. A source without a resolvable destination is shown as plain text
 * rather than a dead link.
 */
function MeasurementSource({
  measurement,
}: {
  measurement: SampleMeasurement
}) {
  const { provenance, source } = measurement
  const label = source ?? '—'

  if (provenance.kind === 'dataset' && provenance.datasetId) {
    return (
      <Link
        to="/datasets/$datasetId/rows"
        params={{ datasetId: provenance.datasetId }}
        search={{
          row: provenance.rowId ?? undefined,
          field: provenance.fieldId ?? undefined,
        }}
        className="text-link"
      >
        {label}
      </Link>
    )
  }

  if (provenance.kind === 'integration' && provenance.instrumentId) {
    return (
      <Link
        to="/instruments/$instrumentId"
        params={{ instrumentId: provenance.instrumentId }}
        className="text-link"
      >
        {label}
      </Link>
    )
  }

  return <span className="text-fg-muted">{label}</span>
}
