import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Section, DescriptionList } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  computeSampleHold,
  formatHoldDate,
} from '#/components/v3/samples/sample-hold-meter'
import {
  describeReleaseChecks,
  isTerminalSampleStatus,
} from '#/components/v3/samples/sample-state'
import { sampleStatus } from '#/components/v3/samples/samples-data'
import {
  formatSampleEventDateTime,
  formatSampleEventDayTime,
} from '#/components/v3/samples/sample-history'
import {
  deriveSampleVolumeSummary,
  fetchSampleDerivedSamples,
  fetchSampleEvents,
  groupDerivedSamples,
  sampleDerivedQueryKey,
} from '#/lib/samples'
import type {
  DerivedDisplayEntry,
  DerivedSample,
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
      const rows = await notebookDataClient.list<RecordWire>(
        'records',
        `?id=in.(${ids.join(',')})&select=id,identifier,title,kind`,
      )
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
        className="max-w-[720px] !gap-y-[9px] !text-body"
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
  const events = useQuery({
    queryKey: sampleEventsQueryKey(sample.id),
    queryFn: () => fetchSampleEvents(notebookDataClient, sample.id),
  })
  const derived = useQuery({
    queryKey: sampleDerivedQueryKey(sample.id),
    queryFn: () => fetchSampleDerivedSamples(notebookDataClient, sample.id),
  })
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

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <div className="grid gap-x-10 gap-y-[26px] md:grid-cols-2">
        <Section title="Properties">
          <DescriptionList
            labelWidth={104}
            items={[
              [
                'Registered volume',
                formatVolume(volume.registered, volume.unit),
              ],
              [
                'Current volume',
                <span className="font-medium">
                  {formatVolume(volume.current, volume.unit)}
                </span>,
              ],
              ['Capsid titre', '—'],
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
            ]}
          />
        </Section>
        <Section title="Storage and release">
          <DescriptionList
            labelWidth={104}
            items={[
              ['Location', sample.storageLocation ?? '—'],
              ['Condition', sample.holdCondition ?? '—'],
              ['Hold limit', holdLimit],
              [
                'Released by',
                sample.releasedAt
                  ? formatHoldDate(new Date(sample.releasedAt))
                  : '—',
              ],
              ['Release basis', releaseChecks],
            ]}
          />
        </Section>
      </div>

      <Section title="Withdrawals" count={withdrawals.length}>
        {withdrawals.length ? (
          <TableBox className="max-w-[900px]">
            <Table aria-label="Withdrawals">
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead align="right">Volume</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead align="right">Remaining</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withdrawals.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="text-fg-muted">
                      {formatSampleEventDayTime(event.createdAt)}
                    </TableCell>
                    <TableCell>
                      {event.actorUserId
                        ? names.userLabel(event.actorUserId)
                        : 'System'}
                    </TableCell>
                    <TableCell align="right">
                      {formatVolume(
                        Math.abs(event.quantityDelta ?? 0),
                        event.quantityUnit ?? volume.unit,
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <WithdrawalPurpose
                        notes={event.notes}
                        recordId={event.purposeRecordId}
                        purposes={purposes.data}
                      />
                    </TableCell>
                    <TableCell align="right">
                      {formatVolume(event.quantityAfter, event.quantityUnit)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
          <TableBox className="max-w-[900px]">
            <Table aria-label="Derived samples">
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Relation</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupDerivedSamples(derived.data).map((entry) => (
                  <DerivedRow key={entry.linkIds.join(',')} entry={entry} />
                ))}
              </TableBody>
            </Table>
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

function DerivedRow({ entry }: { entry: DerivedDisplayEntry }) {
  const status = entry.status ? sampleStatus(entry.status) : null
  return (
    <TableRow>
      <TableCell
        className="mono"
        style={entry.depth > 0 ? { paddingLeft: 26 } : undefined}
      >
        {entry.depth > 0 ? '↳ ' : ''}
        {entry.recordId ? (
          <Link
            to="/samples/$sampleId"
            params={{ sampleId: entry.recordId }}
            className="text-link"
          >
            {entry.identifier}
          </Link>
        ) : (
          entry.identifier
        )}
      </TableCell>
      <TableCell>{entry.title}</TableCell>
      <TableCell>{entry.relation ?? '—'}</TableCell>
      <TableCell>
        {status ? <Status tone={status.tone}>{status.label}</Status> : '—'}
      </TableCell>
    </TableRow>
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
