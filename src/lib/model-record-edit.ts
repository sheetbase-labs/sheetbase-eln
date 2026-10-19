import { parseModelFieldInput } from '#/lib/model-fields'
import type { ModelFieldDefinition } from '#/lib/model-fields'

/** The form value a stored field value starts from when editing a record. */
export function initialModelFieldValues(
  fields: readonly ModelFieldDefinition[],
  stored: Record<string, unknown> | null | undefined,
): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {}
  for (const field of fields) {
    const raw = stored?.[field.fieldName]
    if (field.logicalType === 'boolean') {
      values[field.fieldName] = raw === true
    } else {
      values[field.fieldName] =
        raw === null || raw === undefined ? '' : String(raw)
    }
  }
  return values
}

/**
 * Only the fields the person changed, in the shape `update_record_custom_fields`
 * merges. A cleared value is sent as null when the field allows it; a cleared
 * required field is left out so the form's own validation can name it.
 */
export function changedModelFieldValues(
  fields: readonly ModelFieldDefinition[],
  initial: Record<string, string | boolean>,
  current: Record<string, string | boolean>,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {}
  for (const field of fields) {
    const before = initial[field.fieldName]
    const after = current[field.fieldName]
    if (after === before) continue
    if (after === '') {
      if (field.nullable) changes[field.fieldName] = null
      continue
    }
    changes[field.fieldName] = parseModelFieldInput(field, after)
  }
  return changes
}

/** The server's reason a field edit was refused, in the UI's words. */
export function describeFieldEditError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : ''
  if (code === 'SB001')
    return 'Someone else changed this record while you were editing. Close this, reopen it and make the change again.'
  if (code === 'SB011')
    return 'This record is locked, so its fields cannot be edited. An admin can unlock it.'
  if (code === 'SB004') return 'This record is archived and cannot be edited.'
  return error instanceof Error ? error.message : 'Could not save the changes.'
}
