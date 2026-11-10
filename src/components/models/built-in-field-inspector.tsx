import { Button } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import type { BuiltInModel } from '#/lib/built-in-models'
import { displayModelFieldValue } from '#/lib/model-fields'
import type { ModelFieldDefinition } from '#/lib/model-fields'
import { fieldTypeName, fieldShowsOn } from './built-in-field-presentation'
import { t } from '#/copy'

export function BuiltInFieldInspector({
  sel,
  model,
  canEdit,
  onEdit,
  onRetire,
}: {
  sel: ModelFieldDefinition
  model: BuiltInModel
  canEdit: boolean
  onEdit: (field: ModelFieldDefinition) => void
  onRetire: (field: ModelFieldDefinition) => void
}) {
  return (
    <Inspector
      aria-label={t('library.models.builtInModelFields.fieldDetails')}
      className="w-[320px]"
    >
      <InspectorSection title={sel.label}>
        {sel.description ? <Muted>{sel.description}</Muted> : null}
      </InspectorSection>
      <InspectorSection
        title={t('library.models.builtInModelFields.definition')}
      >
        <DescriptionList
          labelWidth={100}
          items={[
            [t('library.models.builtInModelFields.type'), fieldTypeName(sel)],
            ...(sel.logicalType === 'category'
              ? [
                  [
                    t('library.models.builtInModelFields.choices'),
                    sel.options
                      .filter((option) => option.lifecycle !== 'retired')
                      .map((option) => option.label)
                      .join(', ') || '—',
                  ] satisfies [string, string],
                ]
              : []),
            [
              t('common.states.required'),
              sel.nullable
                ? t('common.states.optional')
                : t('common.states.required'),
            ],
            [
              t('library.models.builtInModelFields.startingValue'),
              sel.defaultValue == null
                ? 'None'
                : displayModelFieldValue(sel, sel.defaultValue),
            ],
            [
              t('library.models.builtInModelFields.status'),
              <Status
                key="status"
                tone={sel.lifecycle === 'retired' ? 'stored' : 'ok'}
              >
                {sel.lifecycle === 'retired'
                  ? t('library.models.builtInModelFields.noLongerUsed')
                  : t('library.models.builtInModelFields.inUse')}
              </Status>,
            ],
          ]}
        />
      </InspectorSection>
      {sel.lifecycle !== 'retired' ? (
        <InspectorSection
          title={t('library.models.builtInModelFields.whereItShows')}
        >
          <DescriptionList
            labelWidth={100}
            items={[
              [
                t('library.models.builtInModelFields.heading'),
                sel.section ??
                  t('library.models.shared.nameDetails', { name: model.name }),
              ],
              [
                t('library.models.builtInModelFields.showsOn'),
                fieldShowsOn(sel),
              ],
            ]}
          />
        </InspectorSection>
      ) : null}
      {canEdit && sel.lifecycle !== 'retired' ? (
        <div className="flex gap-2">
          <IconButton
            variant="secondary"
            icon="edit"
            label={t('common.actions.edit')}
            onClick={() => onEdit(sel)}
          />
          <Button variant="quiet" onClick={() => onRetire(sel)}>
            {t('library.models.builtInModelFields.stopUsing')}
          </Button>
        </div>
      ) : null}
      {sel.lifecycle !== 'retired' ? (
        <Muted>
          {t('library.models.builtInModelFields.theTypeAndWhetherIt')}
        </Muted>
      ) : null}
    </Inspector>
  )
}
