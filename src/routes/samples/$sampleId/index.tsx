import { createFileRoute } from '@tanstack/react-router'

import { Section, DescriptionList } from '#/components/v3/ui/layout'
import { useSampleRecord } from '../$sampleId'

/** UI port: the sample Details tab. */
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
    </div>
  )
}
