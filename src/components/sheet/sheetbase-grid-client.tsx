import { HotTable } from '@handsontable/react-wrapper'
import type { HotTableRef } from '@handsontable/react-wrapper'
import { memo, useCallback } from 'react'
import { registerAllModules } from 'handsontable/registry'

import type { SheetbaseGridClientProps } from './sheetbase-grid'

registerAllModules()

function SheetbaseGridClientBase({
  settings,
  licenseKey,
  onReady,
}: SheetbaseGridClientProps) {
  // Stabilize the ref callback so it doesn't change between renders.
  // A new ref function on every render would cause React to call the
  // old ref with null and the new ref with the instance, which can
  // interfere with Handsontable's internal state during interactions
  // like the autofill drag.
  const refCallback = useCallback(
    (ref: HotTableRef | null) => {
      onReady?.(ref?.hotInstance ?? null)
    },
    [onReady],
  )
  return (
    <HotTable
      {...settings}
      className="sheetbase-grid"
      licenseKey={licenseKey}
      themeName="ht-theme-main"
      ref={refCallback}
    />
  )
}

// Memoize so that parent re-renders (e.g. formula bar state changes,
// selection updates) don't re-render the HotTable component when
// its props (settings, licenseKey, onReady) haven't actually changed.
// This is critical for editor stability: a re-render of HotTable
// causes it to call updateSettings, which can kill the active editor.
export const SheetbaseGridClient = memo(SheetbaseGridClientBase)
