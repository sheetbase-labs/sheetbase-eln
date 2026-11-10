import { Field } from '#/components/ui/input'
import { Textarea } from '#/components/inventory/list'
import { t } from '#/copy'
import type { ModelMetadataPatch } from '#/lib/model-fields'
import type { RecordModelVersionDefinition } from '#/lib/record-model-versions'

type VersionField = RecordModelVersionDefinition['fields'][number]

export function RecordModelFieldCategoryEditor({
  field,
  input,
  onInputChange,
  onChange,
}: {
  field: VersionField
  input: string | undefined
  onInputChange: (input: string) => void
  onChange: (patch: ModelMetadataPatch<VersionField>) => void
}) {
  function updateChoices(raw: string) {
    onInputChange(raw)

    const keys = new Set(
      raw
        .split('\n')
        .map((key) => key.trim())
        .filter(Boolean),
    )

    const existing = field.options ?? []
    const existingKeys = new Set(existing.map((option) => option.key))

    const options = existing.map((option) => ({
      ...option,
      lifecycle: keys.has(option.key)
        ? ('active' as const)
        : ('retired' as const),
    }))

    for (const key of keys) {
      if (!existingKeys.has(key)) {
        options.push({
          id: crypto.randomUUID(),
          key,
          label: key,
          displayOrder: options.length,
          lifecycle: 'active',
        })
      }
    }

    onChange({ category_source: { kind: 'embedded' }, options })
  }

  return (
    <Field
      label={t('library.models.recordModelVersionEditor.allowedChoices')}
      hint={t(
        'library.models.recordModelVersionEditor.oneChoicePerLineExisting',
      )}
    >
      <Textarea
        value={
          input ??
          (field.options ?? [])
            .flatMap((option) =>
              option.lifecycle === 'active' ? [option.key] : [],
            )
            .join('\n')
        }
        onChange={(event) => updateChoices(event.target.value)}
      />
    </Field>
  )
}
