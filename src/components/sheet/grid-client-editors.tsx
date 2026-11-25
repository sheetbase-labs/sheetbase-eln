import type { SpreadsheetCustomEditor } from '@sheetbase-labs/sheetbase-table'
import { useEffect, useMemo, useRef } from 'react'

import { createFormulaReferenceEditor } from './formula-reference-editor-factory'
import { TypedTextEditorCell } from './typed-text-editor'
import type { SheetbaseGridProps } from './sheetbase-grid'
import type { GridClientLayout } from './grid-client-layout'

/** The picker's commit belongs to the live engine editor and its write gate. */
function RecordPickerOpener({
  row,
  column,
  columnId,
  commit,
  cancel,
  onOpen,
}: {
  row: number
  column: number
  columnId?: string
  commit: (value: string) => void
  cancel: () => void
  onOpen: NonNullable<SheetbaseGridProps['onOpenRecordPicker']>
}) {
  const lastOpened = useRef<string | null>(null)
  useEffect(() => {
    const key = `${row}:${column}`

    if (lastOpened.current === key) return
    lastOpened.current = key
    onOpen(
      { rowIndex: row, columnIndex: column, columnId: columnId ?? '' },
      {
        commit: (value) => commit(value ?? ''),
        cancel,
      },
    )
  }, [row, column, columnId, commit, cancel, onOpen])

  return null
}

export function useGridEditors(
  onOpen: SheetbaseGridProps['onOpenRecordPicker'],
  layout: GridClientLayout,
) {
  return useMemo(() => {
    const editors: SpreadsheetCustomEditor[] = []

    if (onOpen)
      editors.push({
        matches: ({ field }) => field?.dataType === 'relationship',
        render: (context) => (
          <RecordPickerOpener
            row={context.point.row}
            column={context.point.column}
            columnId={context.columnId}
            commit={context.commit}
            cancel={context.cancel}
            onOpen={onOpen}
          />
        ),
      })

    if (
      layout.columns.some(
        (column) => column.formula === true && column.readOnly !== true,
      )
    ) {
      editors.push(
        createFormulaReferenceEditor(({ point }) => {
          const column = layout.columns.at(point.column)

          return column?.formula === true && column.readOnly !== true
        }),
      )
    }

    if (
      layout.columns.some(
        (column) => column.editText !== undefined && column.readOnly !== true,
      )
    ) {
      editors.push({
        matches: ({ point }) => {
          const column = layout.columns.at(point.column)

          return column?.editText !== undefined && column.readOnly !== true
        },
        render: (context) => {
          const column = layout.columns.at(context.point.column)

          // Opened on the cell (Enter, double-click): start from the readable
          // text. Opened by typing: keep what was typed.
          const draft =
            context.initialDraft === context.storedValue &&
            context.storedValue !== ''
              ? (column?.editText?.(context.storedValue) ??
                context.initialDraft)
              : context.initialDraft

          return (
            <TypedTextEditorCell
              key={context.address}
              label={column?.label ?? context.address}
              initialDraft={draft}
              commit={context.commit}
              cancel={context.cancel}
            />
          )
        },
      })
    }

    return editors.length > 0 ? editors : undefined
  }, [onOpen, layout.columns])
}
