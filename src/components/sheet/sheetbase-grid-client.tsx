import { HotTable } from '@handsontable/react-wrapper'
import type { HotTableRef } from '@handsontable/react-wrapper'
import { memo, useEffect, useMemo, useRef } from 'react'
import type { CellValue, RangeType } from 'handsontable'
import type Handsontable from 'handsontable/base'
import { registerAllModules } from 'handsontable/registry'

import type {
  SheetbaseGridClientProps,
  SheetbaseGridSettings,
} from './sheetbase-grid'

registerAllModules()

function includesReadOnlyCell(hot: Handsontable, ranges: RangeType[]) {
  return ranges.some((range) => {
    const startRow = Math.max(0, Math.min(range.startRow, range.endRow))
    const endRow = Math.max(range.startRow, range.endRow)
    const startCol = Math.max(0, Math.min(range.startCol, range.endCol))
    const endCol = Math.max(range.startCol, range.endCol)

    for (let row = startRow; row <= endRow; row += 1) {
      for (let col = startCol; col <= endCol; col += 1) {
        if (hot.getCellMeta(row, col).readOnly) return true
      }
    }
    return false
  })
}

function announceCutStatus(statusId: string, message: string) {
  const status = document.getElementById(statusId)
  if (status) status.textContent = message
}

function SheetbaseGridClientBase({
  settings,
  licenseKey,
  ariaLabel,
  descriptionId,
  cutStatusId,
  onReady,
}: SheetbaseGridClientProps) {
  const spreadsheetSettings = useMemo<SheetbaseGridSettings>(() => {
    const callerBeforeCut = settings.beforeCut
    return {
      ...settings,
      // Keep the spreadsheet contract wrapper-owned and explicit rather than
      // relying on vendor defaults that callers could accidentally replace.
      selectionMode: 'multiple',
      navigableHeaders: false,
      tabNavigation: true,
      outsideClickDeselects: true,
      enterBeginsEditing: true,
      enterMoves: { row: 1, col: 0 },
      tabMoves: { row: 0, col: 1 },
      autoWrapRow: false,
      autoWrapCol: false,
      beforeCut: function (
        this: Handsontable,
        data: CellValue[][],
        ranges: RangeType[],
      ) {
        if (includesReadOnlyCell(this, ranges)) {
          announceCutStatus(
            cutStatusId,
            'Cut is unavailable because the active range contains read-only or derived cells.',
          )
          return false
        }
        announceCutStatus(cutStatusId, '')
        return callerBeforeCut?.call(this, data, ranges)
      },
    }
  }, [cutStatusId, settings])

  // The wrapper's hotInstance is assigned during the child's mount, after a
  // callback ref first sees the wrapper. Read it in the parent effect instead.
  const hotRef = useRef<HotTableRef>(null)
  useEffect(() => {
    const hot = hotRef.current?.hotInstance
    if (!hot) return
    hot.rootElement.setAttribute('aria-label', ariaLabel)
    hot.rootElement.setAttribute('aria-describedby', descriptionId)
    onReady?.(hot)
    return () => onReady?.(null)
  }, [ariaLabel, descriptionId, onReady])

  return (
    <HotTable
      {...spreadsheetSettings}
      className="sheetbase-grid"
      licenseKey={licenseKey}
      themeName="ht-theme-main"
      ref={hotRef}
    />
  )
}

// Memoize so that parent re-renders (e.g. formula bar state changes,
// selection updates) don't re-render the HotTable component when
// its props haven't actually changed.
// This is critical for editor stability: a re-render of HotTable
// causes it to call updateSettings, which can kill the active editor.
export const SheetbaseGridClient = memo(SheetbaseGridClientBase)
