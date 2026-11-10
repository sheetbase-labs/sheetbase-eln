import { useState } from 'react'

import { Button } from '#/components/ui/button'
import { Section, DescriptionList } from '#/components/ui/layout'
import { AddedFields } from '#/components/models/added-fields'
import { t } from '#/copy'

import type { PropertyItem } from './-sample-property-items'

/**
 * The two-column Properties and Storage and release block, with the model's
 * added fields beside them and a toggle that reveals the fields left empty.
 */
export function SamplePropertySections({
  sampleId,
  propertyItems,
  storageItems,
}: {
  sampleId: string
  propertyItems: PropertyItem[]
  storageItems: PropertyItem[]
}) {
  // Most properties start empty, so they sit behind a toggle instead of a
  // column of dashes.
  const [showEmpty, setShowEmpty] = useState(false)

  const hideEmpty = (items: PropertyItem[]) =>
    showEmpty ? items : items.filter(([, value]) => value !== '—')

  const emptyCount = [...propertyItems, ...storageItems].filter(
    ([, value]) => value === '—',
  ).length

  return (
    <>
      <div className="grid gap-x-10 gap-y-[26px] md:grid-cols-2">
        <Section title={t('library.samples.summary.properties')}>
          <DescriptionList labelWidth={104} items={hideEmpty(propertyItems)} />
        </Section>
        <Section title={t('library.samples.summary.storageAndRelease')}>
          <DescriptionList labelWidth={104} items={hideEmpty(storageItems)} />
        </Section>
        <AddedFields
          modelKey="sample"
          objectId={sampleId}
          variant="section"
          labelWidth={104}
        />
      </div>

      {emptyCount > 0 ? (
        <div>
          <Button variant="quiet" onClick={() => setShowEmpty(!showEmpty)}>
            {showEmpty
              ? t('library.samples.summary.hideEmptyFields')
              : t('library.samples.summary.showEmptyFields', { emptyCount })}
          </Button>
        </div>
      ) : null}
    </>
  )
}
