import type { ScientificRecordKind } from '#/lib/scientific-records'
import type { RecordPickerResult } from '#/components/scientific/record-picker'
import { formatRecordReferenceLabel } from '#/lib/record-reference-cell'

export function sheetRecordPickerKind(
  modelKey: string,
): ScientificRecordKind | null {
  switch (modelKey) {
    case 'sample':
      return 'sample'
    case 'material':
      return 'material'
    case 'protocol_template':
      return 'protocol_template'
    default:
      return null
  }
}

export function sheetRecordSelectionLabel(result: RecordPickerResult): string {
  return formatRecordReferenceLabel({
    identifier: result.identifier,
    title: result.title,
  })
}
