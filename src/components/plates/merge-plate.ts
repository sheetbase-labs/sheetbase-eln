/**
 * Combine a plate reader export with a layout: the layout decides the roles and
 * samples, and the readings the export carries fill in the gaps.
 */
import { parsePlateTable } from '#/lib/plate-assay'
import type { AssayWell, PlateReadout } from '#/lib/plate-assay'

/** Combine the readings with a layout: the layout decides roles and samples. */
export function mergePlate(dataText: string, layoutText: string) {
  const data = parsePlateTable(dataText)
  const layout = layoutText.trim() ? parsePlateTable(layoutText) : null
  let wells: AssayWell[] = data.wells
  const readout: PlateReadout = { ...data.readout }

  if (layout && layout.wells.length > 0) {
    wells = layout.wells

    for (const [code, v] of Object.entries(layout.readout)) {
      if (!(code in readout)) readout[code] = v
    }
  }

  const warnings = [...data.warnings, ...(layout?.warnings ?? [])]

  return {
    wells,
    readout,
    format: layout?.format ?? data.format,
    warnings,
  }
}
