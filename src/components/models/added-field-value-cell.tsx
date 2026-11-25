import type {
  ModelFieldDefinition,
  ModelFieldRecordValues,
} from '#/lib/model-fields'
import { RecordLinkValue } from '#/components/datasets/record-link-value'
import { linkedRecordIds, useRecordLinkLabels } from '#/lib/record-link-labels'
import { addedFieldDisplay } from './added-field-values'
import { usePersonNames } from './person-names'

const NO_IDS: readonly string[] = []

export function AddedFieldValueCell({
  field,
  value,
}: {
  field: ModelFieldDefinition
  value: ModelFieldRecordValues['customFields'][string] | undefined
}) {
  const people = usePersonNames(field.logicalType === 'person')
  const isLink = field.logicalType === 'reference'
  // A link (a File field among them) reads as the linked record, not its id.
  const labels = useRecordLinkLabels(isLink ? linkedRecordIds([value]) : NO_IDS)

  return (
    <span
      className={value == null || value === '' ? 'text-fg-muted' : undefined}
    >
      {isLink && value != null && value !== '' ? (
        <RecordLinkValue value={value} labels={labels.data ?? {}} />
      ) : (
        addedFieldDisplay(field, value, people)
      )}
    </span>
  )
}
