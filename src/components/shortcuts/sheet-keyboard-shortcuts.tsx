import { useMemo } from 'react'
import type { RefObject } from 'react'

import type { SheetbaseGridHandle } from '#/components/sheet/sheetbase-grid'
import { notebookShortcuts } from '#/lib/shortcut-scopes'
import { isEditableTarget } from '#/lib/shortcuts'
import { useRegisterShortcuts, useShortcutScope } from './shortcut-provider'

/** Register actual cell operations only while this grid owns keyboard focus. */
export function SheetKeyboardShortcuts({
  handle,
  containerRef,
  readOnly,
  activeInput,
  rowCount,
  columnCount,
}: {
  handle: SheetbaseGridHandle | null
  containerRef: RefObject<HTMLElement | null>
  readOnly: boolean
  activeInput: string
  rowCount: number
  columnCount: number
}) {
  useShortcutScope('notebook')
  useRegisterShortcuts(
    useMemo(() => {
      if (!handle) return []
      return notebookShortcuts({
        editCell: !readOnly
          ? () => handle.editActiveInput(activeInput)
          : undefined,
        cancelEdit: () => {
          handle.cancelEdit()
          handle.focus()
        },
        nextCell: () => {
          const { row, column } = handle.snapshot().selection.focus
          handle.selectCell(row, column + 1)
          handle.focus()
        },
        saveRow: !readOnly
          ? () => {
              handle.commitEdit()
              handle.focus()
            }
          : undefined,
      }).map((definition) => ({
        ...definition,
        when: (event: KeyboardEvent) => {
          if (
            !(event.target instanceof HTMLElement) ||
            !containerRef.current?.contains(event.target)
          )
            return false
          const { row, column } = handle.snapshot().selection.focus
          if (row < 0 || row >= rowCount || column < 0 || column >= columnCount)
            return false
          const editing = isEditableTarget(event.target)
          if (definition.id === 'notebook-edit-cell') return !editing
          if (definition.id === 'notebook-next-cell')
            // Tab is the focus-advance key, so the grid never wraps it at the
            // last column: focus returns to the page there, as the grid's own
            // description states. Wrapping would trap keyboard focus.
            return !editing && !event.shiftKey && column + 1 < columnCount
          return editing
        },
      }))
    }, [handle, containerRef, readOnly, activeInput, rowCount, columnCount]),
  )
  return null
}
