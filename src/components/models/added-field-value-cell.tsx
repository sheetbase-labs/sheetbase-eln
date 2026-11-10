import type {
  ModelFieldDefinition,
  ModelFieldRecordValues,
} from '#/lib/model-fields'
import { addedFieldDisplay } from './added-field-values'

export function AddedFieldValueCell({
  field,
  value,
}: {
  field: ModelFieldDefinition
  value: ModelFieldRecordValues['customFields'][string] | undefined
}) {
  return (
    <span
      className={value == null || value === '' ? 'text-fg-muted' : undefined}
    >
      {addedFieldDisplay(field, value)}
    </span>
  )
}
