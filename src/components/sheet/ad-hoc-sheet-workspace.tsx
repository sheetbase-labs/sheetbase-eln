import type { SheetInstance } from '#/lib/sheet-instance-data'

import { CanonicalSheetEditor } from './canonical-sheet-workspace'
import { SheetbaseGrid, SheetbaseTableGrid } from './sheetbase-grid'

/**
 * Local grid for Instances that currently have no source Definition.
 *
 * COMP-06 step 2 gives the ad-hoc surface a `sheetbase-table` backend behind
 * the neutral `SheetbaseGridProps`; all domain behaviour (validation, write
 * attribution, presentation) stays in `CanonicalSheetEditor`, which is
 * engine-agnostic. It is opt-in via `VITE_SHEETBASE_TABLE_GRID` until the
 * package exposes the pre-commit write veto, clipboard before-hooks and
 * editor hooks the contract needs — without them the fail-closed write path
 * and the record picker regress, so Handsontable stays the default.
 */
const tableGridEnabled = import.meta.env.VITE_SHEETBASE_TABLE_GRID === 'true'

export function AdHocSheetWorkspace({
  instance,
  readOnly = false,
}: {
  instance: SheetInstance
  readOnly?: boolean
}) {
  return (
    <CanonicalSheetEditor
      instance={instance}
      projectId={instance.projectId}
      readOnly={readOnly}
      gridComponent={tableGridEnabled ? SheetbaseTableGrid : SheetbaseGrid}
    />
  )
}
