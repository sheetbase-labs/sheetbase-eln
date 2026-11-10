import { z } from 'zod'
import { modelFieldValueText, parseModelFieldInput } from '#/lib/model-fields'
import type {
  ModelFieldDefinition,
  ModelFieldRecordValues,
} from '#/lib/model-fields'

/** The form value a stored field value starts from when editing a record. */
export function initialModelFieldValues(
  fields: readonly ModelFieldDefinition[],
  stored: ModelFieldRecordValues['customFields'] | null | undefined,
): Record<string, string | boolean> {
  const values = new Map<string, string | boolean>()

  for (const field of fields) {
    const raw = stored?.[field.fieldName]

    if (field.logicalType === 'boolean') {
      values.set(field.fieldName, raw === true)
    } else {
      values.set(
        field.fieldName,
        raw === null || raw === undefined ? '' : modelFieldValueText(raw),
      )
    }
  }

  return Object.fromEntries(values)
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
): Record<string, ReturnType<typeof parseModelFieldInput>> {
  const changes = new Map<string, ReturnType<typeof parseModelFieldInput>>()

  for (const field of fields) {
    const before = initial[field.fieldName]
    const after = current[field.fieldName]

    if (after === before) continue

    if (after === '') {
      if (field.nullable) changes.set(field.fieldName, null)
      continue
    }

    changes.set(field.fieldName, parseModelFieldInput(field, after))
  }

  return Object.fromEntries(changes)
}

/** The server's reason a field edit was refused, in the UI's words. */
export function describeFieldEditError(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Transport rejections are external; the code object schema decodes them immediately, with Error supplying the fallback message.
  error: unknown,
): string {
  const parsed = z.object({ code: z.string() }).safeParse(error)
  const code = parsed.success ? parsed.data.code : ''

  if (code === 'SB001')
    return 'Someone else changed this record while you were editing. Close this, reopen it and make the change again.'

  if (code === 'SB011')
    return 'This record is locked, so its fields cannot be edited. An admin can unlock it.'

  if (code === 'SB004') return 'This record is archived and cannot be edited.'

  return error instanceof Error ? error.message : 'Could not save the changes.'
}
