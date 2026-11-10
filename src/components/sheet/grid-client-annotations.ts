import type { RefObject } from 'react'
import { useEffect, useMemo, useReducer } from 'react'
import type { SpreadsheetHandle } from '@sheetbase-labs/sheetbase-table'

import type { SheetbaseGridProps } from './sheetbase-grid'
import { cellAddress } from './grid-client-layout'
import type { GridClientLayout } from './grid-client-layout'

export function useGridAnnotations(
  notes: SheetbaseGridProps['annotations'],
  layout: GridClientLayout,
  handleRef: RefObject<SpreadsheetHandle | null>,
) {
  const annotations = useMemo(
    () =>
      (notes ?? []).flatMap((note) => {
        const row = layout.rowIndex.get(note.rowId)
        const column = layout.columnIndex.get(note.columnId)

        return row === undefined || column === undefined
          ? []
          : [
              {
                address: cellAddress(row, column),
                recordId: note.rowId,
                fieldId: note.columnId,
                text: note.text,
              },
            ]
      }),
    [notes, layout],
  )

  const [version, changed] = useReducer((value: number) => value + 1, 0)
  useEffect(() => {
    const handle = handleRef.current

    if (!handle) return
    const current = handle.snapshot().annotations ?? []

    const desired = new Map(
      annotations.map((note) => [
        JSON.stringify([note.recordId, note.fieldId]),
        note,
      ]),
    )

    const existing = new Map(
      current.map((note) => [
        JSON.stringify([note.recordId, note.fieldId]),
        note,
      ]),
    )

    // The installed engine's annotation methods capture their render's array.
    // Apply one change per acknowledgment, yielding between large ranges.
    for (const previous of current) {
      if (desired.has(JSON.stringify([previous.recordId, previous.fieldId])))
        continue
      const row = layout.rowIndex.get(previous.recordId)

      const column =
        previous.fieldId === undefined
          ? undefined
          : layout.columnIndex.get(previous.fieldId)

      // Never move a deleted identity's old annotation to its former address.
      if (row !== undefined && column !== undefined) {
        handle.removeAnnotation(cellAddress(row, column))

        return
      }
    }

    for (const note of annotations) {
      if (
        existing.get(JSON.stringify([note.recordId, note.fieldId]))?.text ===
        note.text
      )
        continue
      handle.setAnnotation(note.address, note.text)

      return
    }
  }, [annotations, layout, handleRef, version])

  return {
    initialAnnotations: annotations,
    onAnnotationsChange: () => setTimeout(changed, 0),
  }
}
