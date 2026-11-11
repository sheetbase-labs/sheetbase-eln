import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Section } from '#/components/ui/layout'
import {
  computeSampleHold,
  formatHoldDate,
} from '#/components/samples/sample-hold-data'
import {
  describeReleaseChecks,
  isTerminalSampleStatus,
} from '#/components/samples/sample-state'
import { useLabelTemplateChoice } from '#/components/samples/use-label-template-choice'
import { SampleLabelCard } from '#/components/samples/sample-label-card'
import {
  deriveSampleVolumeSummary,
  fetchSampleDerivedSamples,
  fetchSampleEvents,
  fetchSampleMeasurements,
  sampleMeasurementsQueryKey,
  sampleDerivedQueryKey,
} from '#/lib/samples'
import type { SampleRecord } from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'

import { sampleEventsQueryKey } from '#/routes/samples/-sample-keys'
import { useSampleRecord } from '../$sampleId'
import { t } from '#/copy'

import { ConsumedDetails } from './-sample-consumed-details'
import { usePurposeRecords } from './-sample-details-data'
import { DerivedSamplesSection } from './-sample-derived'
import { SamplePropertySections } from './-sample-properties'
import {
  samplePropertyItems,
  sampleStorageItems,
} from './-sample-property-items'
import { WithdrawalsSection } from './-sample-withdrawals'

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
    ? t('library.samples.summary.daysFromHarvest', {
        expiry: formatHoldDate(hold.expiry),
        count: hold.totalDays,
      })
    : '—'

  const releaseChecks = describeReleaseChecks(sample.releaseChecks) ?? '—'

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <SamplePropertySections
        sampleId={sample.id}
        propertyItems={samplePropertyItems({
          volume,
          capsid,
          created,
          purposes: purposes.data,
          sample,
        })}
        storageItems={sampleStorageItems({
          sample,
          holdLimit,
          releaseChecks,
        })}
      />

      {/* LAB-05.1: the label a printed code carries. The context rail shows it
          for a live sample; this copy is for a consumed or archived one. */}
      {sample.archivedAt || isTerminalSampleStatus(sample.status) ? (
        <Section title={t('library.samples.summary.label')}>
          <div className="max-w-[360px]">
            <SampleLabelCard record={sample} template={labelChoice.chosen} />
          </div>
        </Section>
      ) : null}

      <WithdrawalsSection
        withdrawals={withdrawals}
        purposes={purposes.data}
        userLabel={names.userLabel}
        unit={volume.unit}
      />

      <DerivedSamplesSection derived={derived.data} sampleId={sample.id} />
    </div>
  )
}
