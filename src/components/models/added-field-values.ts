import type {
  ModelFieldDefinition,
  ModelFieldRecordValues,
} from '#/lib/model-fields'
import { displayModelFieldValue, modelFieldValueText } from '#/lib/model-fields'
import { formatDate } from '#/lib/format-date'
import { builtInModelQueryKeys } from './built-in-model-data'
import type { BuiltInModel } from '#/lib/built-in-models'
import type { FieldGroup } from '#/lib/model-subtypes'
import { t } from '#/copy'

/** A field's value as the record pages show it. */
export function addedFieldDisplay(
  field: ModelFieldDefinition,
  raw: ModelFieldRecordValues['customFields'][string] | undefined,
): string {
  if (field.logicalType === 'date')
    return raw == null || raw === ''
      ? '—'
      : formatDate(modelFieldValueText(raw))

  if (field.logicalType === 'timestamp')
    return raw == null || raw === ''
      ? '—'
      : formatDate(modelFieldValueText(raw), { time: true })

  return displayModelFieldValue(field, raw)
}

/** First-appearance order, with the model's default heading first. */
export function groupAddedFields(
  fields: readonly ModelFieldDefinition[],
  defaultHeading: string,
): Array<{ heading: string; fields: ModelFieldDefinition[] }> {
  const groups = new Map<string, ModelFieldDefinition[]>()

  for (const field of fields) {
    const heading = field.section?.trim() || defaultHeading
    groups.set(heading, [...(groups.get(heading) ?? []), field])
  }

  return [...groups.entries()]
    .sort(([a], [b]) =>
      a === defaultHeading ? -1 : b === defaultHeading ? 1 : 0,
    )
    .map(([heading, grouped]) => ({ heading, fields: grouped }))
}

export function addedFieldListQueryKey(modelKey: string) {
  return [...builtInModelQueryKeys.all, 'list-values', modelKey] as const
}

/** Preserve the built-in headings; subtype fields default to their type name. */
export function addedFieldGroups(
  model: BuiltInModel,
  ownFields: readonly ModelFieldDefinition[],
  inherited: readonly FieldGroup[] | null,
  exclude?: readonly string[],
) {
  const keep = (field: ModelFieldDefinition) =>
    !exclude?.includes(field.fieldName)

  const heading = t('library.models.shared.nameDetails', { name: model.name })

  const groups = inherited
    ? inherited.flatMap((group) =>
        groupAddedFields(
          group.fields.filter(keep),
          group.modelKey === model.key ? heading : group.modelName,
        ),
      )
    : groupAddedFields(ownFields.filter(keep), heading)

  return groups.filter((group) => group.fields.length > 0)
}

/** Sort dates as written and numbers numerically; empty values sort last. */
export function addedFieldSortValue(
  field: ModelFieldDefinition,
  customFields: ModelFieldRecordValues['customFields'] | null | undefined,
): string | number | undefined {
  const raw = customFields?.[field.fieldName]

  if (raw == null || raw === '') return undefined

  if (field.logicalType === 'date' || field.logicalType === 'timestamp')
    return modelFieldValueText(raw)

  if (field.logicalType === 'integer' || field.logicalType === 'decimal') {
    const number = Number(raw)

    if (Number.isFinite(number)) return number
  }

  return addedFieldDisplay(field, raw)
}
