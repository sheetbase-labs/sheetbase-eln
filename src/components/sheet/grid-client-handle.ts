import type { SpreadsheetHandle } from '@sheetbase-labs/sheetbase-table'
import type { RefObject } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'

import type { SheetbaseGridHandle, SheetbaseGridProps } from './sheetbase-grid'

export function useGridHandle(
  handleRef: RefObject<SpreadsheetHandle | null>,
  onReady: SheetbaseGridProps['onReady'],
) {
  const readyRef = useRef(onReady)
  useLayoutEffect(() => {
    readyRef.current = onReady
  }, [onReady])

  const neutralHandle = useMemo<SheetbaseGridHandle>(
    () => ({
      editActiveInput: (value) => handleRef.current?.editActiveInput(value),
      commitEdit: () => handleRef.current?.commitEdit(),
      cancelEdit: () => handleRef.current?.cancelEdit(),
      focus: () => handleRef.current?.focus(),
      selectCell: (row, column, options) =>
        handleRef.current?.selectCell(row, column, options),
      selectCellAddress: (address, options) =>
        handleRef.current?.selectCellAddress(address, options) ?? false,
      scrollCellIntoView: (row, column) =>
        handleRef.current?.scrollCellIntoView(row, column),
      snapshot: () => {
        const handle = handleRef.current

        if (!handle) throw new Error('The Sheet grid is unavailable.')
        const { data, selection } = handle.snapshot()

        return {
          data,
          selection: {
            anchor: {
              row: selection.anchor.row,
              column: selection.anchor.column,
            },
            focus: { row: selection.focus.row, column: selection.focus.column },
          },
        }
      },
    }),
    [handleRef],
  )

  // The engine announces its handle once. Development's double mount runs
  // this cleanup in between, which would leave the host with no handle, so a
  // remount with a live engine that was told "none" announces it again.
  const announcedRef = useRef(false)
  useEffect(() => {
    if (handleRef.current && !announcedRef.current) {
      announcedRef.current = true
      readyRef.current?.(neutralHandle)
    }

    return () => {
      announcedRef.current = false
      readyRef.current?.(null)
    }
  }, [handleRef, neutralHandle])

  return useMemo(
    () => (handle: SpreadsheetHandle | null) => {
      announcedRef.current = handle !== null
      readyRef.current?.(handle ? neutralHandle : null)
    },
    [neutralHandle],
  )
}
