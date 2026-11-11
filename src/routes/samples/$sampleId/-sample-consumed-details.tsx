import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { DescriptionList } from '#/components/ui/layout'
import { formatHoldDate } from '#/components/samples/sample-hold-data'
import {
  deriveSampleVolumeSummary,
  fetchSampleDerivedSamples,
  fetchSampleEvents,
  sampleDerivedQueryKey,
} from '#/lib/samples'
import type { DerivedSample, SampleRecord } from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'
import { sampleEventsQueryKey } from '#/routes/samples/-sample-keys'
import { t } from '#/copy'

import { formatVolume, usePurposeRecords } from './-sample-details-data'

/** The design's compact detail for a consumed or disposed sample. */
export function ConsumedDetails({ sample }: { sample: SampleRecord }) {
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
          [
            t('library.samples.summary.registeredVolume'),
            formatVolume(volume.registered, volume.unit),
          ],
          [
            t('library.samples.summary.currentVolume'),
            formatVolume(volume.current, volume.unit),
          ],
          [
            t('library.samples.summary.lastWithdrawal'),
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
            t('library.samples.summary.derivedSamples'),
            <DerivedSummary key="derived" derived={derived.data ?? []} />,
          ],
          [
            t('library.samples.summary.location'),
            sample.storageLocation ?? '—',
          ],
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
