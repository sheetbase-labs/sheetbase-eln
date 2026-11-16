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

/**
 * Column numbers from words such as "1", "1, 2" or "11-12". Numbers outside
 * the plate are dropped.
 */
export function parseColumnList(text: string, columns: number): number[] {
  const found = new Set<number>()

  for (const part of text.split(/[\s,;]+/)) {
    const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(part)

    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])].sort(
        (a, b) => a - b,
      )

      for (let n = from; n <= to; n++) if (n >= 1 && n <= columns) found.add(n)
    } else if (/^\d+$/.test(part)) {
      const n = Number(part)

      if (n >= 1 && n <= columns) found.add(n)
    }
  }

  return [...found].sort((a, b) => a - b)
}

/**
 * Mark whole columns of a plate as controls. A grid from a reader has no
 * roles, and most assays keep their controls in the first and last columns.
 */
export function assignControlColumns(
  wells: AssayWell[],
  columns: number,
  controls: { negative: string; positive: string },
): AssayWell[] {
  const negative = new Set(parseColumnList(controls.negative, columns))
  const positive = new Set(parseColumnList(controls.positive, columns))

  if (negative.size === 0 && positive.size === 0) return wells

  return wells.map((well) => {
    const column = Number(/\d+$/.exec(well.wellCode)?.[0])

    if (negative.has(column))
      return { ...well, role: 'negative_control', sampleLabel: null }

    if (positive.has(column))
      return { ...well, role: 'positive_control', sampleLabel: null }

    return well
  })
}
