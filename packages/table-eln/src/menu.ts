import type { SpreadsheetMenuAction } from 'sheetbase-table/dev'

export interface RecordMenuActionOptions {
  /** Resolve the record UUID of the cell a menu was opened on — null when the cell is not a record reference. */
  recordIdAt: (context: { axis: 'row' | 'column'; index: number; fieldId?: string }) =>
    | string
    | null
  /** Navigate to a record. The ELN wires its router here. */
  openRecord: (recordId: string) => void
  label?: string
}

/** "Open record" context-menu action for record-reference columns. A no-op on cells that hold no record. */
export function createRecordMenuActions(
  options: RecordMenuActionOptions,
): SpreadsheetMenuAction[] {
  return [
    {
      label: options.label ?? 'Open record',
      onSelect: (context) => {
        const recordId = options.recordIdAt(context)
        if (recordId) options.openRecord(recordId)
      },
    },
  ]
}
