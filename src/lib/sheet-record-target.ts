/**
 * Record actions follow the Model named on the Definition, not a hard-coded
 * golden `sample` key. Falls back only when no Model relationship is present.
 */
export function sheetRecordTargetModelKey(
  configuration: {
    columns: Array<{
      field: {
        relationship?: {
          target?: { kind?: string; modelKey?: string }
        } | null
      }
    }>
  } | null | undefined,
): string | null {
  if (!configuration) return null
  for (const column of configuration.columns) {
    const target = column.field.relationship?.target
    if (target?.kind === 'model' && target.modelKey) return target.modelKey
  }
  return null
}
