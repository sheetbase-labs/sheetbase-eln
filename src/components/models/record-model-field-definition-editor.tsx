import { Icon } from '#/components/icons'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { t } from '#/copy'
import { FIELD_LOGICAL_TYPES } from '#/lib/field-definition'
import type { ModelMetadataPatch } from '#/lib/model-fields'
import type { RecordModelVersionDefinition } from '#/lib/record-model-versions'
import { RecordModelFieldCategoryEditor } from './record-model-field-category-editor'
import { RecordModelFieldDefaultsEditor } from './record-model-field-defaults-editor'
import { RecordModelFieldQuantityEditor } from './record-model-field-quantity-editor'

type VersionField = RecordModelVersionDefinition['fields'][number]

export function RecordModelFieldDefinitionEditor({
  field,
  locked,
  publishedVersion,
  busy,
  open,
  choiceInput,
  onChoiceInputChange,
  onChange,
}: {
  field: VersionField
  locked: boolean
  publishedVersion: number | null | undefined
  busy: boolean
  open: boolean
  choiceInput: string | undefined
  onChoiceInputChange: (input: string) => void
  onChange: (patch: ModelMetadataPatch<VersionField>) => void
}) {
  const numeric =
    field.logical_type === 'integer' || field.logical_type === 'decimal'

  return (
    <details className="group min-w-0" open={open}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-label hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
        <Icon
          name="chevronDown"
          size={14}
          className="shrink-0 -rotate-90 text-fg-muted group-open:rotate-0"
        />
        <span className="min-w-0 flex-1 break-words font-medium">
          {field.label || field.field_name}
        </span>
        <span className="text-fg-muted">
          {field.logical_type}
          {field.lifecycle === 'retired'
            ? t('library.models.recordModelVersionEditor.retired')
            : ''}
        </span>
      </summary>
      <fieldset
        disabled={busy}
        className="m-0 flex min-w-0 flex-col gap-4 border-0 border-t border-border-subtle px-3 pb-4 pt-3"
      >
        <legend className="sr-only">
          {t('library.models.recordModelVersionEditor.configuration', {
            label: field.label || field.field_name,
          })}
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('library.models.recordModelVersionEditor.label')}>
            <Input
              value={field.label}
              required
              onChange={(event) => onChange({ label: event.target.value })}
            />
          </Field>
          <Field
            label={t('library.models.recordModelVersionEditor.key')}
            hint={
              locked
                ? t(
                    'library.models.recordModelVersionEditor.lockedPublishedInVStable',
                    { publishedVersion: publishedVersion ?? '—' },
                  )
                : t(
                    'library.models.recordModelVersionEditor.notYetPublishedTheKey',
                  )
            }
          >
            <Input
              aria-label={t('library.models.recordModelVersionEditor.fieldKey')}
              className="mono"
              value={field.field_name}
              disabled={locked}
              onChange={(event) => onChange({ field_name: event.target.value })}
            />
          </Field>
        </div>
        <div>
          <Field label={t('library.models.recordModelVersionEditor.type')}>
            <Select
              aria-label={t(
                'library.models.recordModelVersionEditor.fieldType',
              )}
              value={field.logical_type}
              onChange={(event) =>
                onChange({
                  logical_type:
                    FIELD_LOGICAL_TYPES.find(
                      (type) => type === event.target.value,
                    ) ?? 'text',
                })
              }
            >
              {FIELD_LOGICAL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {numeric ? (
          <RecordModelFieldQuantityEditor field={field} onChange={onChange} />
        ) : null}
        {field.logical_type === 'reference' ? (
          <Field
            label={t(
              'library.models.recordModelVersionEditor.targetRecordTypeKey',
            )}
            hint={t(
              'library.models.recordModelVersionEditor.aBuiltInOrWorkspace',
            )}
          >
            <Input
              value={field.validation.targetModelKey ?? ''}
              required
              onChange={(event) =>
                onChange({
                  validation: {
                    ...field.validation,
                    targetModelKey: event.target.value,
                  },
                  relationship: {
                    target: { kind: 'model', modelKey: event.target.value },
                    cardinality: 'one',
                  },
                })
              }
            />
          </Field>
        ) : null}
        {field.logical_type === 'category' ? (
          <RecordModelFieldCategoryEditor
            field={field}
            input={choiceInput}
            onInputChange={onChoiceInputChange}
            onChange={onChange}
          />
        ) : null}
        <RecordModelFieldDefaultsEditor
          field={field}
          numeric={numeric}
          onChange={onChange}
        />
        <label className="flex items-start gap-2 border-t border-border-subtle pt-3 text-label">
          <input
            type="checkbox"
            className="mt-0.5 shrink-0"
            checked={field.lifecycle === 'retired'}
            onChange={(event) =>
              onChange({
                lifecycle: event.target.checked ? 'retired' : 'active',
              })
            }
          />
          {t(
            'library.models.recordModelVersionEditor.retireFieldKeepItsHistorical',
          )}
        </label>
      </fieldset>
    </details>
  )
}
