import type { SheetInstance } from '#/lib/sheet-instance-data'

import { CanonicalSheetEditor } from './canonical-sheet-workspace'
import { SheetbaseTableGrid } from './sheetbase-grid'

/**
 * Local grid for Instances that currently have no source Definition.
 *
 * COMP-06 steps 2-3: the ad-hoc surface runs on the `sheetbase-table` backend.
 * All domain behaviour (validation, write attribution, presentation) stays in
 * `CanonicalSheetEditor`, which is engine-agnostic; `SheetbaseTableGrid` maps
 * the neutral `SheetbaseGridProps` onto the package. Canonical and notebook
 * surfaces still run on Handsontable.
 */
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
      gridComponent={SheetbaseTableGrid}
    />
  )
}
