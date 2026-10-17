import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { EmptyState } from '#/components/v3/ui/empty-state'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { fetchSampleMeasurements } from '#/lib/samples'
import type { SampleMeasurement } from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'

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

  const columns: RegistryColumn<SampleMeasurement>[] = [
    {
      id: 'measurement',
      header: 'Measurement',
      cell: ({ row }) => (
        <span className="font-medium">{row.original.measurement}</span>
      ),
    },
    {
      id: 'value',
      header: 'Value',
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
      header: 'Unit',
      cell: ({ row }) => row.original.unit ?? '—',
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'method',
      header: 'Method',
      cell: ({ row }) => row.original.method ?? '—',
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'source',
      header: 'Source',
      cell: ({ row }) => <MeasurementSource measurement={row.original} />,
    },
    {
      id: 'result',
      header: 'Result',
      cell: ({ row }) => row.original.result ?? '—',
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'measured',
      header: 'Measured',
      cell: ({ row }) => row.original.measuredAt.slice(0, 10),
      meta: { cellClassName: 'num text-fg-muted' },
    },
  ]

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <div className="flex items-center gap-2">
        <h2 className="text-section">
          Measurements <span className="num text-fg-muted">{rows.length}</span>
        </h2>
      </div>
      <p className="m-0 -mt-4 text-label text-fg-muted">
        Values come from datasets and QC; they can’t be typed here.
      </p>

      {rows.length ? (
        <TableBox>
          <RegistryGrid
            label="Measurements"
            rows={rows}
            columns={columns}
            getRowId={(m) => m.id}
            selectable={false}
          />
        </TableBox>
      ) : (
        <EmptyState
          className="py-2"
          title="No measurements yet"
          description="Values recorded against this sample in a dataset or QC appear here, with a link to their source row."
        />
      )}
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
