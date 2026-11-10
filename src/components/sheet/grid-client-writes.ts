import { parseAddress } from '@sheetbase-labs/sheetbase-table'
import type {
  SpreadsheetBeforeCellsChange,
  SpreadsheetMutationSource,
  SpreadsheetProps,
} from '@sheetbase-labs/sheetbase-table'

import type {
  SheetbaseGridCellChange,
  SheetbaseGridProps,
  SheetbaseGridWriteSource,
} from './sheetbase-grid'
import { gridStoredText } from './grid-client-values'
import type { GridClientLayout } from './grid-client-layout'

function toWriteSource(
  source: SpreadsheetMutationSource,
): SheetbaseGridWriteSource {
  if (source === 'paste') return 'paste'

  if (source === 'fill') return 'fill'

  if (source === 'clear') return 'clear'

  return 'edit'
}

function sourceForLabel(label: string): SpreadsheetMutationSource {
  const text = label.toLowerCase()

  if (
    text.startsWith('sort ') ||
    (text.startsWith('clear ') && text.endsWith(' sort'))
  )
    return 'sort'

  if (text.startsWith('insert ') || text.startsWith('delete '))
    return 'structure'

  if (text.startsWith('revert ')) return 'revert'

  if (text.startsWith('move ')) return 'move'

  if (text.startsWith('paste')) return 'paste'

  if (text.startsWith('autofill') || text.startsWith('fill')) return 'fill'

  if (text.startsWith('clear ') || text.startsWith('cut ')) return 'clear'

  if (text.startsWith('replace')) return 'replace'

  return 'edit'
}

export function gridWrites(
  props: SheetbaseGridProps,
  layout: GridClientLayout,
) {
  const beforeCellsChange: SpreadsheetBeforeCellsChange = (changes, source) => {
    if (source === 'sort' || source === 'structure' || source === 'revert')
      return undefined

    // A bound grid must never move values between record addresses.
    if (source === 'move') return false

    const neutral: SheetbaseGridCellChange[] = changes.map((change) => ({
      rowIndex: change.row,
      rowId: change.recordId ?? layout.rows[change.row]?.id,
      columnId: change.fieldId ?? layout.columns.at(change.column)?.id ?? '',
      previous: change.before ?? null,
      next: change.next ?? null,
      editable: change.editable === false ? false : undefined,
    }))

    if (props.beforeCellsChange?.(neutral, toWriteSource(source)) === false)
      return false
    neutral.forEach((change, index) => {
      changes[index].next =
        change.next === null ? undefined : gridStoredText(change.next)
    })

    return undefined
  }

  const onMutation: NonNullable<SpreadsheetProps['onMutation']> = (
    mutation,
  ) => {
    const source = sourceForLabel(mutation.label)

    if (
      source === 'sort' ||
      source === 'structure' ||
      source === 'revert' ||
      source === 'move'
    )
      return
    const changes: SheetbaseGridCellChange[] = []

    for (const cell of mutation.cells) {
      const { row, column } = parseAddress(cell.address)
      const definition = layout.columns.at(column)

      if (!definition) continue
      changes.push({
        rowIndex: row,
        rowId: layout.rows[row]?.id,
        columnId: definition.id,
        previous: cell.before ?? null,
        next: cell.after ?? null,
      })
    }

    if (changes.length > 0)
      props.onCellsChange?.(changes, toWriteSource(source))
  }

  return {
    beforeCellsChange,
    onMutation,
    onBeforeRowsInsert: (row: number, count: number) =>
      props.onBeforeRowsInsert?.(row, count) === false ? false : undefined,
    onRowsInserted: (row: number, count: number) =>
      props.onRowsInserted?.(row, count, 'edit'),
    onBeforeRowsRemove: (row: number, count: number) =>
      props.onBeforeRowsRemove?.(row, count) === false ? false : undefined,
    onRowsRemoved: (row: number, count: number) =>
      props.onRowsRemoved?.(row, count, 'edit'),
  }
}
