import { Field, Input } from '#/components/ui/input'
import { t } from '#/copy'
import type { ModelMetadataPatch } from '#/lib/model-fields'
import type { RecordModelVersionDefinition } from '#/lib/record-model-versions'

type VersionField = RecordModelVersionDefinition['fields'][number]

export function RecordModelFieldDefaultsEditor({
  field,
  numeric,
  onChange,
}: {
  field: VersionField
  numeric: boolean
  onChange: (patch: ModelMetadataPatch<VersionField>) => void
}) {
  function updateValidation(bound: 'min' | 'max', raw: string) {
    const validation = { ...field.validation }

    if (raw === '') delete validation[bound]
    else validation[bound] = Number(raw)
    onChange({ validation })
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle pt-3">
      <h4 className="text-label font-semibold">
        {t('library.models.recordModelVersionEditor.validationAndDefaults')}
      </h4>
      <label className="flex items-center gap-2 text-label">
        <input
          type="checkbox"
          checked={!field.nullable}
          onChange={(event) => onChange({ nullable: !event.target.checked })}
        />
        {t('library.models.recordModelVersionEditor.requiredForNewRecords')}
      </label>
      {numeric ? (
        <div className="grid grid-cols-2 gap-2">
          {(['min', 'max'] as const).map((bound) => (
            <Field
              key={bound}
              label={
                bound === 'min'
                  ? t('library.models.recordModelVersionEditor.minimum')
                  : t('library.models.recordModelVersionEditor.maximum')
              }
            >
              <Input
                type="number"
                step="any"
                value={
                  field.validation[bound] === undefined
                    ? ''
                    : String(field.validation[bound])
                }
                onChange={(event) =>
                  updateValidation(bound, event.target.value)
                }
              />
            </Field>
          ))}
          <Field
            label={t(
              'library.models.recordModelVersionEditor.defaultForNewRecords',
            )}
          >
            <Input
              type="number"
              step="any"
              value={
                // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The version decoder establishes finite JSON; numeric inputs show only numeric defaults, not text/category/object defaults.
                typeof field.default_value === 'number'
                  ? String(field.default_value)
                  : ''
              }
              onChange={(event) =>
                onChange({
                  default_value:
                    event.target.value === ''
                      ? null
                      : Number(event.target.value),
                })
              }
            />
          </Field>
        </div>
      ) : null}
    </div>
  )
}
