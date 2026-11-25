import type {
  ModelFieldDefinition,
  ModelFieldRecordValues,
} from '#/lib/model-fields'
import { addedFieldDisplay } from './added-field-values'
import { usePersonNames } from './person-names'

export function AddedFieldValueCell({
  field,
  value,
}: {
  field: ModelFieldDefinition
  value: ModelFieldRecordValues['customFields'][string] | undefined
}) {
  const people = usePersonNames(field.logicalType === 'person')

  return (
    <span
      className={value == null || value === '' ? 'text-fg-muted' : undefined}
    >
      {addedFieldDisplay(field, value, people)}
    </span>
  )
}
