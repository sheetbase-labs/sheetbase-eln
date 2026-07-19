import { HotTable } from '@handsontable/react-wrapper'
import { registerAllModules } from 'handsontable/registry'

import type { SheetbaseGridClientProps } from './sheetbase-grid'

registerAllModules()

export function SheetbaseGridClient({
  settings,
  licenseKey,
}: SheetbaseGridClientProps) {
  return (
    <HotTable
      {...settings}
      className="sheetbase-grid"
      licenseKey={licenseKey}
      themeName="ht-theme-main"
    />
  )
}
