import { createFileRoute } from '@tanstack/react-router'

import { Section, DescriptionList } from '#/components/v3/ui/layout'
import {
  computeSampleHold,
  formatHoldDate,
} from '#/components/v3/samples/sample-hold-meter'
import { describeReleaseChecks } from '#/components/v3/samples/sample-state'
import { useSampleRecord } from '../$sampleId'

/** UI port: the sample Details tab. LAB-02 step 3 adds the stored hold /
 * quarantine / release / disposal facts (the design's Storage and release
 * section) so a state change is visible on the record, not only in the banner. */
export const Route = createFileRoute('/samples/$sampleId/')({
  component: SampleDetails,
})

function SampleDetails() {
  const { sampleId } = Route.useParams()
  const { data: sample } = useSampleRecord(sampleId)
  if (!sample) return null
  const quantity =
    sample.quantity != null
      ? `${sample.quantity.toLocaleString('en-GB', { maximumFractionDigits: 2 })}${sample.quantityUnit ? ` ${sample.quantityUnit}` : ''}`
      : '—'
  const hold = computeSampleHold(sample)
  const holdLimit = hold
    ? `${formatHoldDate(hold.expiry)}${hold.condition ? ` · ${hold.condition}` : ''}`
    : '—'
  const releaseChecks = describeReleaseChecks(sample.releaseChecks) ?? '—'
  const quarantined = sample.quarantinedAt
    ? `${sample.quarantinedAt.slice(0, 10)}${
        sample.quarantineReason ? ` · ${sample.quarantineReason}` : ''
      }`
    : '—'
  const disposed = sample.disposedAt
    ? `${sample.disposedAt.slice(0, 10)}${
        sample.disposalReason ? ` · ${sample.disposalReason}` : ''
      }`
    : '—'
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <Section title="Details">
        <DescriptionList
          labelWidth={140}
          items={[
            ['Type', sample.sampleType ?? '—'],
            ['Quantity', quantity],
            ['Storage location', sample.storageLocation ?? '—'],
            ['Barcode', <span className="mono">{sample.barcode ?? '—'}</span>],
            ['Low-stock threshold', sample.lowStockThreshold ?? '—'],
            ['Registered', sample.createdAt.slice(0, 10)],
            ['Updated', sample.updatedAt.slice(0, 10)],
            ['Notes', sample.notes ?? '—'],
          ]}
        />
      </Section>
      <Section title="Storage and release">
        <DescriptionList
          labelWidth={140}
          items={[
            ['Condition', sample.holdCondition ?? '—'],
            ['Hold limit', holdLimit],
            ['Quarantined', quarantined],
            [
              'Released',
              sample.releasedAt ? sample.releasedAt.slice(0, 10) : '—',
            ],
            ['Release checks', releaseChecks],
            ['Disposed', disposed],
          ]}
        />
      </Section>
    </div>
  )
}
