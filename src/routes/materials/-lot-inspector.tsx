/**
 * The lot page's right-hand inspector: release, the printable label, the added
 * fields, the replacement lot and the last few movements. It reads only what
 * the page has already loaded.
 */
import type { ComponentProps } from 'react'

import { Button } from '#/components/ui/button'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
} from '#/components/ui/layout'
import { AddedFields } from '#/components/models/added-fields'
import { LabelTemplatePicker } from '#/components/samples/label-template-picker'
import { SampleLabelCard } from '#/components/samples/sample-label-card'
import type { useLabelTemplateChoice } from '#/components/samples/use-label-template-choice'
import type { MaterialListRow } from '#/components/materials/materials-data'
import { MOVEMENT_LABELS } from '#/lib/reagent-data'
import type { CertificateFile, ReagentMovement } from '#/lib/reagent-data'
import { t } from '#/copy'

import { LOT_PAGE_FIELDS, dayLabel, movementChange } from './-lot-page-model'
import { LotCertificateLabel } from './-lot-tabs'

export function LotInspector({
  row,
  identifier,
  title,
  certificate,
  labelChoice,
  labelSource,
  hazards,
  replacement,
  ledger,
}: {
  row: MaterialListRow
  identifier: string
  title: string
  certificate: CertificateFile | null | undefined
  labelChoice: ReturnType<typeof useLabelTemplateChoice>
  labelSource: ComponentProps<typeof SampleLabelCard>['source']
  hazards: ComponentProps<typeof SampleLabelCard>['hazards']
  replacement: { targetIdentifier: string; reason: string | null } | null
  ledger: readonly ReagentMovement[] | undefined
}) {
  return (
    <Inspector
      aria-label={t('library.materials.lot.lotContext')}
      className="w-[300px]"
    >
      <InspectorSection title={t('library.materials.lot.release')}>
        <DescriptionList
          labelWidth={88}
          items={[
            [
              t('library.materials.lot.releasedBy'),
              row.releasedBy
                ? `${row.releasedBy} · ${dayLabel(row.releasedAt)}`
                : '—',
            ],
            [
              'Certificate',
              <LotCertificateLabel certificate={certificate} fallback={null} />,
            ],
          ]}
        />
      </InspectorSection>
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
      <AddedFields
        modelKey="material"
        objectId={row.id}
        labelWidth={88}
        exclude={LOT_PAGE_FIELDS}
      />
      <InspectorSection
        title={
          replacement
            ? t('library.materials.lot.replacementLot')
            : t('library.materials.lot.noReplacementLot')
        }
      >
        <p className="text-label text-fg-muted">
          {replacement
            ? `${replacement.targetIdentifier}${replacement.reason ? ` · ${replacement.reason}` : ''}`
            : t('library.materials.lot.noLotHasBeenRegistered')}
        </p>
      </InspectorSection>
      <InspectorSection title={t('library.materials.lot.recentMovements')}>
        {ledger && ledger.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {ledger.slice(0, 3).map((m) => (
              <li key={m.id} className="text-label">
                {MOVEMENT_LABELS[m.operation]} {movementChange(m)},{' '}
                {dayLabel(m.createdAt)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-label text-fg-muted">
            {t('library.materials.lot.noMovementsYet')}
          </p>
        )}
      </InspectorSection>
    </Inspector>
  )
}
