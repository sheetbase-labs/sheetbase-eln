import type { SheetInstance } from '#/lib/sheet-instance-data'

import { CanonicalSheetEditor } from './canonical-sheet-workspace'

/**
 * Local grid for Instances that currently have no source Definition.
 *
 * COMP-06 steps 2-3: the ad-hoc surface runs on the `sheetbase-table` backend
 * through `CanonicalSheetEditor`, which is engine-agnostic and now renders
 * `SheetbaseTableGrid` for every canonical sheet. All domain behaviour
 * (validation, write attribution, presentation) stays in the editor; the
 * notebook `scientific-sheet-block` still runs on Handsontable until step 3.
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
    />
  )
}
