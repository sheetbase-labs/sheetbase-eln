/**
 * The lot page's side panel: its other fields, the printable label, the
 * replacement lot when there is one, links and recent activity. It reads only
 * what the page has already loaded, apart from links and activity.
 */
import type { ComponentProps } from 'react'

import { Button } from '#/components/ui/button'
import { InspectorSection } from '#/components/ui/layout'
import { AddedFields } from '#/components/models/added-fields'
import {
  RecordActivity,
  RecordLinks,
  RecordProperties,
} from '#/components/record-page/record-side-panel'
import { LabelTemplatePicker } from '#/components/samples/label-template-picker'
import { SampleLabelCard } from '#/components/samples/sample-label-card'
import type { useLabelTemplateChoice } from '#/components/samples/use-label-template-choice'
import type { MaterialListRow } from '#/components/materials/materials-data'
import { t } from '#/copy'

import { LOT_PAGE_FIELDS, dayLabel } from './-lot-page-model'

export function LotSidePanel({
  recordId,
  row,
  identifier,
  title,
  labelChoice,
  labelSource,
  hazards,
  replacement,
  onShowHistory,
}: {
  recordId: string
  row: MaterialListRow
  identifier: string
  title: string
  labelChoice: ReturnType<typeof useLabelTemplateChoice>
  labelSource: ComponentProps<typeof SampleLabelCard>['source']
  hazards: ComponentProps<typeof SampleLabelCard>['hazards']
  replacement: { targetIdentifier: string; reason: string | null } | null
  onShowHistory: () => void
}) {
  return (
    <>
      <RecordProperties
        items={[
          {
            label: t('library.materials.lot.catalogue'),
            value: row.catalogNo,
            mono: true,
          },
          {
            label: t('library.materials.lot.received'),
            value: row.received ? dayLabel(row.received) : null,
          },
          {
            label: t('library.materials.lot.expiry'),
            value: row.expiry ? dayLabel(row.expiry) : null,
          },
        ]}
      />
      <AddedFields
        modelKey="material"
        objectId={row.id}
        labelWidth={104}
        exclude={LOT_PAGE_FIELDS}
      />
      <InspectorSection title={t('safety.label.title')}>
        <SampleLabelCard
          record={{ identifier, title }}
          template={labelChoice.chosen}
          source={labelSource}
          hazards={hazards}
        />
        <LabelTemplatePicker
          templates={labelChoice.templates}
          chosen={labelChoice.chosen}
          onChoose={labelChoice.choose}
        />
        <Button
          size="sm"
          className="mt-2"
          data-print-hide
          onClick={() => window.print()}
        >
          {t('safety.label.print')}
        </Button>
      </InspectorSection>
      {replacement ? (
        <InspectorSection title={t('library.materials.lot.replacementLot')}>
          <p className="text-label text-fg-muted">
            {`${replacement.targetIdentifier}${replacement.reason ? ` · ${replacement.reason}` : ''}`}
          </p>
        </InspectorSection>
      ) : null}
      <RecordLinks id={recordId} />
      <RecordActivity recordId={recordId} onShowHistory={onShowHistory} />
    </>
  )
}
