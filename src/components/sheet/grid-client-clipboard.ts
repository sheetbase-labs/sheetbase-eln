import type {
  SpreadsheetClipboard,
  SpreadsheetClipboardPayload,
  SpreadsheetClipboardRange,
} from '@sheetbase-labs/sheetbase-table'

import type {
  SheetbaseGridCellValue,
  SheetbaseGridClipboardRange,
  SheetbaseGridProps,
} from './sheetbase-grid'
import { gridStoredText } from './grid-client-values'

function toNeutralRange(
  range: SpreadsheetClipboardRange,
): SheetbaseGridClipboardRange {
  return {
    startRow: range.top,
    startColumn: range.left,
    endRow: range.bottom,
    endColumn: range.right,
    columnIds: [...range.columnIds],
  }
}

function clipboardOverride(
  payload: SpreadsheetClipboardPayload,
  values: SheetbaseGridCellValue[][],
  transformed: SheetbaseGridCellValue[][] | void,
): SpreadsheetClipboardPayload | undefined {
  const rows = (transformed ?? values).map((row) => row.map(gridStoredText))

  const unchanged =
    rows.length === payload.values.length &&
    rows.every(
      (row, index) =>
        row.length === payload.values[index].length &&
        row.every((value, column) => value === payload.values[index][column]),
    )

  // Preserve the original TSV (including its quoting) unless a hook rewrites it.
  if (!transformed && unchanged) return undefined

  return {
    text: rows.map((row) => row.join('\t')).join('\n'),
    values: rows,
    range: payload.range,
  }
}

export function gridClipboard(props: SheetbaseGridProps): SpreadsheetClipboard {
  const columns = new Map(props.columns.map((column) => [column.id, column]))

  const announce = (message: string) => {
    if (!props.cutStatusId || typeof document === 'undefined') return
    const node = document.getElementById(props.cutStatusId)

    if (node) node.textContent = message
  }

  return {
    onCopy: (payload) => {
      const values: SheetbaseGridCellValue[][] = payload.values.map((row) => [
        ...row,
      ])

      return clipboardOverride(
        payload,
        values,
        props.clipboard?.onCopy?.(values, toNeutralRange(payload.range)),
      )
    },
    onCut: (payload) => {
      if (
        props.readOnly ||
        payload.range.columnIds.some((id) => {
          const column = id === undefined ? undefined : columns.get(id)

          return column?.readOnly === true || column?.source === 'calculated'
        })
      ) {
        announce(
          'Cut is unavailable because the active range contains read-only or derived cells.',
        )

        return false
      }

      announce('')

      const values: SheetbaseGridCellValue[][] = payload.values.map((row) => [
        ...row,
      ])

      return clipboardOverride(
        payload,
        values,
        props.clipboard?.onCut?.(values, toNeutralRange(payload.range)),
      )
    },
    onPaste: (payload, target) => {
      const values: SheetbaseGridCellValue[][] = payload.values.map((row) => [
        ...row,
      ])

      return clipboardOverride(
        payload,
        values,
        props.clipboard?.onPaste?.(values, target),
      )
    },
    onCutStatusChange: (status) => announce(status?.label ?? ''),
  }
}
