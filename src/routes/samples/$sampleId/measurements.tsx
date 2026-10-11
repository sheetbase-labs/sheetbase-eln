import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { CapabilityGap } from '#/components/v3/ui/capability-gap'
import { EmptyState } from '#/components/v3/ui/empty-state'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { fetchSampleMeasurements } from '#/lib/samples'
import type { SampleMeasurement } from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'
import { WORKSPACE_ADMIN_ROLES } from '#/lib/nav-visibility'

/**
 * LAB-03: the sample Measurements tab is a read-only view of authoritative
 * values. Each value is aggregated from a Dataset row linked to the sample or
 * from an integration/QC result, and links back to its source row. Values
 * cannot be typed here; the standalone bench-reading surface lives elsewhere
 * (MOB-02).
 *
 * R5-SHELL-03: recording measurements is optional per deployment. When
 * `sampleMeasurements` is off the tab entry stays visible but its content is the
 * honest gap — no values are read, so nothing fabricated can appear.
 */
export const Route = createFileRoute('/samples/$sampleId/measurements')({
  component: MeasurementsTab,
})

function MeasurementsTab() {
  const { sampleId } = Route.useParams()
  const { capabilities, auth } = Route.useRouteContext()
  if (!capabilities.sampleMeasurements) {
    return (
      <MeasurementsGap
        sampleId={sampleId}
        admin={WORKSPACE_ADMIN_ROLES.some(
          (role) => role === auth?.workspace?.role,
        )}
      />
    )
  }
  return <MeasurementsTable sampleId={sampleId} />
}

function MeasurementsGap({
  sampleId,
  admin,
}: {
  sampleId: string
  admin: boolean
}) {
  return (
    <div className="px-4 py-[22px] md:px-8">
      <CapabilityGap
        icon="tube"
        title="Measurements aren’t recorded on samples in this workspace yet"
        will="This tab will list every value recorded against the sample — titre, turbidity, endotoxin — with its method, the dataset it came from and whether it meets its limit."
        instead={[
          {
            label: 'Datasets',
            link: { to: '/datasets' },
            note: 'Results are in the dataset rows, by sample ID',
          },
          {
            label: 'Sample history',
            link: { to: '/samples/$sampleId/history', params: { sampleId } },
            note: 'Release and QC results from an upstream system appear as history entries',
          },
        ]}
        roadmap="RM-112"
        admin={admin}
      />
    </div>
  )
}

function MeasurementsTable({ sampleId }: { sampleId: string }) {
  const measurements = useQuery({
    queryKey: ['ui-port', 'sample-measurements', sampleId],
    queryFn: () => fetchSampleMeasurements(notebookDataClient, sampleId),
  })
  const rows = measurements.data ?? []

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
          <Table aria-label="Measurements">
            <TableHeader>
              <TableRow>
                <TableHead>Measurement</TableHead>
                <TableHead align="right">Value</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Measured</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.measurement}</TableCell>
                  <TableCell align="right" className="num">
                    {m.valueText ?? (m.value != null ? String(m.value) : '—')}
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    {m.unit ?? '—'}
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    {m.method ?? '—'}
                  </TableCell>
                  <TableCell>
                    <MeasurementSource measurement={m} />
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    {m.result ?? '—'}
                  </TableCell>
                  <TableCell className="num text-fg-muted">
                    {m.measuredAt.slice(0, 10)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableBox>
      ) : (
        <EmptyState
          className="py-2"
          title="No measurements yet"
          body="Values recorded against this sample in a dataset or QC appear here, with a link to their source row."
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
