import { chunkIds } from '#/lib/chunk-ids'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Section, DescriptionList } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import {
  computeSampleHold,
  formatHoldDate,
} from '#/components/v3/samples/sample-hold-meter'
import {
  describeReleaseChecks,
  isTerminalSampleStatus,
} from '#/components/v3/samples/sample-state'
import { sampleStatus } from '#/components/v3/samples/samples-data'
import { useLabelTemplateChoice } from '#/components/v3/samples/label-template-picker'
import { SampleLabelCard } from '#/components/v3/samples/sample-label-card'
import { AddedFields } from '#/components/v3/models/added-fields'
import {
  formatSampleEventDateTime,
  formatSampleEventDayTime,
} from '#/components/v3/samples/sample-history'
import {
  deriveSampleVolumeSummary,
  fetchSampleDerivedSamples,
  fetchSampleEvents,
  fetchSampleMeasurements,
  sampleMeasurementsQueryKey,
  groupDerivedSamples,
  sampleDerivedQueryKey,
} from '#/lib/samples'
import type {
  DerivedDisplayEntry,
  DerivedSample,
  SampleEvent,
  SampleRecord,
} from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'
import type { RecordWire } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'

import { sampleEventsQueryKey, useSampleRecord } from '../$sampleId'

/** UI port (LAB-03): the sample Details tab.
 *
 * Released samples show the design's two-column Properties / Storage and
 * release block, the withdrawal ledger and the samples derived from this lot.
 * A consumed sample shows the design's compact summary instead. Every value is
 * read from canonical data — the volume facts and withdrawals from
 * `api.sample_events`, the derived samples from the sample-typed lineage edges
 * — and an unmodelled value renders as an em dash rather than a guess.
 */
export const Route = createFileRoute('/samples/$sampleId/')({
  component: SampleDetails,
})

function formatVolume(
  value: number | null | undefined,
  unit: string | null,
): string {
  if (value == null) return '—'
  const amount = value.toLocaleString('en-GB', { maximumFractionDigits: 2 })
  return unit ? `${amount} ${unit}` : amount
}

function usePurposeRecords(purposeIds: string[]) {
  const ids = Array.from(new Set(purposeIds.filter(Boolean)))
  return useQuery({
    queryKey: ['ui-port', 'sample-purpose-records', ids.join(',')],
    enabled: ids.length > 0,
    queryFn: async () => {
      const rows = (
        await Promise.all(
          chunkIds(ids).map((group) =>
            notebookDataClient.list<RecordWire>(
              'records',
              `?id=in.(${group.join(',')})&select=id,identifier,title,kind`,
            ),
          ),
        )
      ).flat()
      return new Map(rows.map((row) => [row.id, row]))
    },
  })
}

function SampleDetails() {
  const { sampleId } = Route.useParams()
  const { data: sample } = useSampleRecord(sampleId)
  if (!sample) return null
  return isTerminalSampleStatus(sample.status) ? (
    <ConsumedDetails sample={sample} />
  ) : (
    <ReleasedDetails sample={sample} />
  )
}

/** The design's compact detail for a consumed or disposed sample. */
function ConsumedDetails({ sample }: { sample: SampleRecord }) {
  const events = useQuery({
    queryKey: sampleEventsQueryKey(sample.id),
    queryFn: () => fetchSampleEvents(notebookDataClient, sample.id),
  })
  const derived = useQuery({
    queryKey: sampleDerivedQueryKey(sample.id),
    queryFn: () => fetchSampleDerivedSamples(notebookDataClient, sample.id),
  })
  const purposes = usePurposeRecords(
    (events.data ?? [])
      .filter((event) => event.operation === 'consume')
      .map((event) => event.purposeRecordId ?? ''),
  )
  const volume = deriveSampleVolumeSummary(sample, events.data ?? [])
  const last = volume.lastWithdrawal
  const purpose = last?.purposeRecordId
    ? purposes.data?.get(last.purposeRecordId)
    : undefined

  return (
    <div className="px-4 py-[22px] md:px-8">
      <DescriptionList
        className="!gap-y-[9px] !text-body"
        labelWidth={170}
        items={[
          ['Registered volume', formatVolume(volume.registered, volume.unit)],
          ['Current volume', formatVolume(volume.current, volume.unit)],
          [
            'Last withdrawal',
            last ? (
              <span>
                {formatHoldDate(new Date(last.at))} ·{' '}
                {formatVolume(last.quantity, last.unit)}
                {purpose ? (
                  <>
                    {' · '}
                    <Link
                      to="/experiments/$expId"
                      params={{ expId: purpose.id }}
                      className="mono text-link"
                    >
                      {purpose.identifier}
                    </Link>
                  </>
                ) : null}
              </span>
            ) : (
              '—'
            ),
          ],
          [
            'Derived samples',
            <DerivedSummary key="derived" derived={derived.data ?? []} />,
          ],
          ['Location', sample.storageLocation ?? '—'],
        ]}
      />
    </div>
  )
}

function DerivedSummary({ derived }: { derived: DerivedSample[] }) {
  if (derived.length === 0) return '—'
  const first = derived[0]?.identifier
  const last = derived[derived.length - 1]?.identifier
  return derived.length === 1
    ? `${derived[0]?.title ?? first}`
    : `${derived.length} samples (${first} … ${last})`
}

/** The design's full detail for a released/available sample. */
function ReleasedDetails({ sample }: { sample: SampleRecord }) {
  const labelChoice = useLabelTemplateChoice()
  const events = useQuery({
    queryKey: sampleEventsQueryKey(sample.id),
    queryFn: () => fetchSampleEvents(notebookDataClient, sample.id),
  })
  const derived = useQuery({
    queryKey: sampleDerivedQueryKey(sample.id),
    queryFn: () => fetchSampleDerivedSamples(notebookDataClient, sample.id),
  })
  // The design states the capsid titre with the dataset row that produced it
  // ("8.6 x 10^11 cp/mL - DS-0311 rows 1-2"). That value is a dataset reading
  // aggregated by api.sample_measurement_provenance, not a field on the sample.
  const measurements = useQuery({
    queryKey: sampleMeasurementsQueryKey(sample.id),
    queryFn: () => fetchSampleMeasurements(notebookDataClient, sample.id),
  })
  const capsid = measurements.data?.find((row) =>
    /capsid/i.test(row.measurement),
  )
  const eventsList = events.data ?? []
  const withdrawals = eventsList.filter(
    (event) => event.operation === 'consume',
  )
  const purposes = usePurposeRecords(
    eventsList.map((event) => event.purposeRecordId ?? ''),
  )
  const names = useUserNames(
    withdrawals.map((event) => event.actorUserId ?? '').filter(Boolean),
  )
  const volume = deriveSampleVolumeSummary(sample, eventsList)
  const created = eventsList.find((event) => event.operation === 'create')
  const hold = computeSampleHold(sample)
  const holdLimit = hold
    ? `${formatHoldDate(hold.expiry)} (${hold.totalDays} days from harvest)`
    : '—'
  const releaseChecks = describeReleaseChecks(sample.releaseChecks) ?? '—'
  const params = { sampleId: sample.id }
  // Most properties start empty, so they sit behind a toggle instead of a column of dashes.
  const [showEmpty, setShowEmpty] = useState(false)
  const hideEmpty = (items: [React.ReactNode, React.ReactNode][]) =>
    showEmpty ? items : items.filter(([, value]) => value !== '—')

  const propertyItems: [React.ReactNode, React.ReactNode][] = [
    ['Registered volume', formatVolume(volume.registered, volume.unit)],
    [
      'Current volume',
      <span className="font-medium">
        {formatVolume(volume.current, volume.unit)}
      </span>,
    ],
    [
      'Capsid titre',
      capsid ? (
        <span>
          {capsid.valueText ??
            (capsid.value != null
              ? capsid.value.toLocaleString('en-GB', {
                  maximumFractionDigits: 2,
                })
              : '—')}
          {capsid.unit ? ` ${capsid.unit}` : ''}
          {capsid.provenance.datasetDisplayId ? (
            <>
              {' · '}
              <span className="mono text-fg-muted">
                {capsid.provenance.datasetDisplayId}
              </span>
            </>
          ) : null}
        </span>
      ) : (
        '—'
      ),
    ],
    ['Cell line', '—'],
    [
      'Produced in',
      <PurposeLink
        key="produced"
        recordId={created?.purposeRecordId}
        purposes={purposes.data}
      />,
    ],
    [
      'Harvested',
      created
        ? formatSampleEventDateTime(created.createdAt)
        : sample.holdStartedAt
          ? formatHoldDate(new Date(sample.holdStartedAt))
          : '—',
    ],
  ]
  const storageItems: [React.ReactNode, React.ReactNode][] = [
    ['Location', sample.storageLocation ?? '—'],
    ['Condition', sample.holdCondition ?? '—'],
    ['Hold limit', holdLimit],
    [
      'Released',
      sample.releasedAt ? formatHoldDate(new Date(sample.releasedAt)) : '—',
    ],
    ['Release basis', releaseChecks],
  ]
  const emptyCount = [...propertyItems, ...storageItems].filter(
    ([, value]) => value === '—',
  ).length

  const withdrawalColumns: RegistryColumn<SampleEvent>[] = [
    {
      id: 'when',
      header: 'When',
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {formatSampleEventDayTime(row.original.createdAt)}
        </span>
      ),
    },
    {
      id: 'by',
      header: 'By',
      cell: ({ row }) =>
        row.original.actorUserId
          ? names.userLabel(row.original.actorUserId)
          : 'System',
    },
    {
      id: 'volume',
      header: 'Volume',
      cell: ({ row }) =>
        formatVolume(
          Math.abs(row.original.quantityDelta ?? 0),
          row.original.quantityUnit ?? volume.unit,
        ),
      meta: rightAligned<SampleEvent>().meta,
    },
    {
      id: 'purpose',
      header: 'Purpose',
      cell: ({ row }) => (
        <WithdrawalPurpose
          notes={row.original.notes}
          recordId={row.original.purposeRecordId}
          purposes={purposes.data}
        />
      ),
      meta: { cellClassName: 'whitespace-normal' },
    },
    {
      id: 'remaining',
      header: 'Remaining',
      cell: ({ row }) =>
        formatVolume(row.original.quantityAfter, row.original.quantityUnit),
      meta: rightAligned<SampleEvent>().meta,
    },
  ]

  const derivedColumns: RegistryColumn<DerivedDisplayEntry>[] = [
    {
      id: 'identifier',
      header: 'ID',
      cell: ({ row }) => (
        // The tree indent the bespoke row carried as an inline cell padding.
        <span
          className="mono"
          style={row.original.depth > 0 ? { marginLeft: 2 } : undefined}
        >
          {row.original.depth > 0 ? '↳ ' : ''}
          {row.original.recordId ? (
            <Link
              to="/samples/$sampleId"
              params={{ sampleId: row.original.recordId }}
              className="text-link"
            >
              {row.original.identifier}
            </Link>
          ) : (
            row.original.identifier
          )}
        </span>
      ),
    },
    {
      id: 'name',
      header: 'Name',
      cell: ({ row }) => row.original.title,
    },
    {
      id: 'relation',
      header: 'Relation',
      cell: ({ row }) => row.original.relation ?? '—',
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.original.status
          ? sampleStatus(row.original.status)
          : null
        return status ? <Status tone={status.tone}>{status.label}</Status> : '—'
      },
    },
  ]

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <div className="grid gap-x-10 gap-y-[26px] md:grid-cols-2">
        <Section title="Properties">
          <DescriptionList labelWidth={104} items={hideEmpty(propertyItems)} />
        </Section>
        <Section title="Storage and release">
          <DescriptionList labelWidth={104} items={hideEmpty(storageItems)} />
        </Section>
        <AddedFields
          modelKey="sample"
          objectId={sample.id}
          variant="section"
          labelWidth={104}
        />
      </div>

      {emptyCount > 0 ? (
        <div>
          <Button variant="quiet" onClick={() => setShowEmpty(!showEmpty)}>
            {showEmpty
              ? 'Hide empty fields'
              : `Show empty fields (${emptyCount})`}
          </Button>
        </div>
      ) : null}

      {/* LAB-05.1: the label a printed code carries. The context rail shows it
          for a live sample; this copy is for a consumed or archived one. */}
      {sample.archivedAt || isTerminalSampleStatus(sample.status) ? (
        <Section title="Label">
          <div className="max-w-[360px]">
            <SampleLabelCard record={sample} template={labelChoice.chosen} />
          </div>
        </Section>
      ) : null}

      <Section title="Withdrawals" count={withdrawals.length}>
        {withdrawals.length ? (
          <TableBox>
            <RegistryGrid
              label="Withdrawals"
              rows={withdrawals}
              columns={withdrawalColumns}
              getRowId={(event) => event.id}
              selectable={false}
            />
          </TableBox>
        ) : (
          <p className="m-0 text-caption text-fg-muted">
            No withdrawals recorded.
          </p>
        )}
      </Section>

      <Section
        title="Derived samples"
        count={derived.data?.length ?? 0}
        action={
          <Link
            to="/samples/$sampleId/lineage"
            params={params}
            className="text-caption text-link"
          >
            Show as tree
          </Link>
        }
      >
        {derived.data?.length ? (
          <TableBox>
            <RegistryGrid
              label="Derived samples"
              rows={groupDerivedSamples(derived.data)}
              columns={derivedColumns}
              getRowId={(entry) => entry.linkIds.join(',')}
              selectable={false}
            />
          </TableBox>
        ) : (
          <p className="m-0 text-caption text-fg-muted">
            No derived samples recorded.
          </p>
        )}
      </Section>
    </div>
  )
}

function PurposeLink({
  recordId,
  purposes,
  fallback = '—',
}: {
  recordId: string | null | undefined
  purposes: Map<string, RecordWire> | undefined
  fallback?: string
}) {
  const record = recordId ? purposes?.get(recordId) : undefined
  if (!record) return <>{fallback}</>
  if (record.kind === 'sample') {
    return (
      <Link
        to="/samples/$sampleId"
        params={{ sampleId: record.id }}
        className="mono text-link"
      >
        {record.identifier}
      </Link>
    )
  }
  return (
    <Link
      to="/experiments/$expId"
      params={{ expId: record.id }}
      className="mono text-link"
    >
      {record.identifier}
    </Link>
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
