import type {
  ModelFieldDefinition,
  ModelFieldLogicalType,
} from '#/lib/model-fields'
import { fieldKeyFromLabel } from '#/lib/built-in-models'
import { t } from '#/copy'

export type AuthoredType = Exclude<ModelFieldLogicalType, 'reference'>

export const TYPE_LABELS: Record<ModelFieldLogicalType, string> = {
  text: t('library.models.builtInModelFields.text'),
  decimal: t('library.models.builtInModelFields.number'),
  integer: t('library.models.builtInModelFields.wholeNumber'),
  boolean: t('library.models.builtInModelFields.yesNo'),
  date: t('library.models.builtInModelFields.date'),
  timestamp: t('library.models.builtInModelFields.dateAndTime'),
  category: t('library.models.builtInModelFields.choice'),
  reference: t('library.models.builtInModelFields.linkToARecord'),
}

export const AUTHORED_TYPES: AuthoredType[] = [
  'text',
  'decimal',
  'integer',
  'boolean',
  'date',
  'timestamp',
  'category',
]

export function fieldTypeName(field: ModelFieldDefinition): string {
  const unit = field.unit?.symbol ? ` · ${field.unit.symbol}` : ''

  return `${TYPE_LABELS[field.logicalType]}${unit}`
}

/** Where an added field appears, in the words the inspector uses. */
export function fieldShowsOn(
  field: Pick<ModelFieldDefinition, 'askOnCreate' | 'showInList'>,
): string {
  return [
    t('library.models.builtInModelFields.recordPage'),
    ...(field.askOnCreate !== false ? ['create form'] : []),
    ...(field.showInList ? ['list column'] : []),
  ].join(', ')
}

export function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`
}

/** Choice labels from the textarea, one per line, without repeats. */
export function parseChoices(
  text: string,
): Array<{ key: string; label: string }> {
  const taken = new Set<string>()
  const choices: Array<{ key: string; label: string }> = []

  for (const line of text.split('\n')) {
    const label = line.trim()

    if (!label || choices.some((choice) => choice.label === label)) continue
    const key = fieldKeyFromLabel(label, taken)
    taken.add(key)
    choices.push({ key, label })
  }

  return choices
}

/** Live fields can change placement and copy, but only new fields define values. */
export function builtInFieldErrors({
  label,
  editing,
  type,
  optionCount,
  required,
  startValue,
  plural,
}: {
  label: string
  editing: boolean
  type: AuthoredType
  optionCount: number
  required: boolean
  startValue: string | boolean
  plural: string
}) {
  const labelError = !label.trim()
    ? t('library.models.builtInModelFields.giveTheFieldAName')
    : label.trim().length > 200
      ? t('library.models.builtInModelFields.keepTheNameUnder200')
      : undefined

  const choicesError =
    !editing && type === 'category' && optionCount === 0
      ? t('library.models.builtInModelFields.addAtLeastOneChoice')
      : undefined

  const startError =
    !editing && required && type !== 'boolean' && startValue === ''
      ? t('library.models.builtInModelFields.aRequiredFieldNeedsA', { plural })
      : undefined

  return {
    labelError,
    choicesError,
    startError,
    blocking: labelError ?? choicesError ?? startError,
  }
}
