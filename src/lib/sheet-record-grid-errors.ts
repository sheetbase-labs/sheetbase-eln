export type SheetRecordGridErrorKind =
  'validation' | 'duplicate' | 'permission' | 'conflict'

export interface SheetRecordGridError {
  rowKey: string
  columnId?: string
  fieldName?: string
  code: string
  kind: SheetRecordGridErrorKind
  message: string
}

export function classifySheetRecordGridError(
  code: string,
): SheetRecordGridErrorKind {
  if (code === 'duplicate_input_row' || code === 'duplicate-input-row')
    return 'duplicate'
  if (code === '42501' || code === 'permission_denied') return 'permission'
  if (code === '23505' || code === 'conflict' || code === 'SB001')
    return 'conflict'
  return 'validation'
}

export function sheetRecordGridErrorsFromValidation(result: {
  rows?: Array<{
    rowKey: string
    errors?: Array<{
      code?: string
      fieldName?: string
      message?: string
    }>
  }>
}): SheetRecordGridError[] {
  return (result.rows ?? []).flatMap((row) =>
    (row.errors ?? []).map((error) => ({
      rowKey: row.rowKey,
      fieldName: error.fieldName,
      code: error.code ?? 'invalid',
      kind: classifySheetRecordGridError(error.code ?? 'invalid'),
      message: error.message ?? 'Invalid value.',
    })),
  )
}

export function nextSheetRecordGridError(
  errors: SheetRecordGridError[],
  current: SheetRecordGridError | null,
): SheetRecordGridError | null {
  if (errors.length === 0) return null
  if (!current) return errors[0]
  const index = errors.findIndex(
    (error) =>
      error.rowKey === current.rowKey &&
      error.code === current.code &&
      error.fieldName === current.fieldName,
  )
  return errors[(index + 1) % errors.length]
}

export function applySheetRecordValidationRerun(
  previousPasted: Record<string, unknown>,
  edited: Record<string, unknown>,
): Record<string, unknown> {
  return { ...previousPasted, ...edited }
}
