/**
 * Laying an experiment's samples out on a plate: standards and blanks down the
 * first columns, then the samples in order, each in as many wells as it has
 * replicates, across the rows or down the columns. The layout is written in the
 * same list form a person can edit by hand (`well,role,sample,concentration,
 * unit,dilution`), so the plate map is a start, not a lock.
 */
import type { AssayWell } from './plate-assay'
import { FORMAT_DIMENSIONS, rowLabel } from './plate-map'
import type { PlateFormat } from './plate-map'

export interface StandardsSpec {
  /** The highest standard. */
  top: number
  unit: string
  /** Each standard is the one above divided by this (2 = two-fold). */
  fold: number
  /** How many different concentrations. */
  points: number
  /** Wells per concentration, side by side. */
  replicates: number
}

export interface FillOptions {
  format: PlateFormat
  /** Sample identifiers, in the order they go on the plate. */
  samples: readonly string[]
  /** Wells per sample. */
  replicates: number
  direction: 'across' | 'down'
  /** How far the samples were diluted; written on each sample well when above 1. */
  dilution: number
  standards: StandardsSpec | null
  /** Blank wells, placed under the standards. */
  blanks: number
}

export interface FillResult {
  wells: AssayWell[]
  /** The layout as list text, ready for the layout box. */
  text: string
  /** Samples that fitted on the plate. */
  placed: number
  /** Samples that did not fit. */
  left: string[]
}

export const LAYOUT_HEADER = 'well,role,sample,concentration,unit,dilution'

const code = (row: number, col: number) => `${rowLabel(row)}${col + 1}`

/** A standard's concentration, kept to a readable length. */
function concentration(top: number, fold: number, index: number): number {
  return Number((top / fold ** index).toPrecision(6))
}

export function fillPlate(options: FillOptions): FillResult {
  const { rows, cols } = FORMAT_DIMENSIONS[options.format]
  const taken = new Set<string>()
  const wells: AssayWell[] = []
  const std = options.standards
  const replicates = Math.max(1, Math.floor(options.replicates))

  if (std) {
    const columns = Math.max(1, Math.min(Math.floor(std.replicates), cols))
    const points = Math.max(1, Math.min(Math.floor(std.points), rows))

    for (let point = 0; point < points; point++)
      for (let col = 0; col < columns; col++) {
        const wellCode = code(point, col)

        taken.add(wellCode)
        wells.push({
          wellCode,
          role: 'standard',
          concentration: concentration(std.top, std.fold, point),
          concentrationUnit: std.unit.trim() || null,
        })
      }
  }

  // Blanks go straight under the standards, in the same columns.
  const blankColumns = std
    ? Math.max(1, Math.min(Math.floor(std.replicates), cols))
    : 1

  let blankRow = std ? Math.min(Math.floor(std.points), rows) : 0
  let placedBlanks = 0

  while (placedBlanks < options.blanks && blankRow < rows) {
    for (
      let col = 0;
      col < blankColumns && placedBlanks < options.blanks;
      col++
    ) {
      const wellCode = code(blankRow, col)

      taken.add(wellCode)
      wells.push({ wellCode, role: 'blank' })
      placedBlanks++
    }

    blankRow++
  }

  const free: string[] = []

  if (options.direction === 'across') {
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++)
        if (!taken.has(code(row, col))) free.push(code(row, col))
  } else {
    for (let col = 0; col < cols; col++)
      for (let row = 0; row < rows; row++)
        if (!taken.has(code(row, col))) free.push(code(row, col))
  }

  let next = 0
  let placed = 0
  const left: string[] = []

  for (const sample of options.samples) {
    if (next + replicates > free.length) {
      left.push(sample)
      continue
    }

    for (let r = 0; r < replicates; r++) {
      const well: AssayWell = {
        wellCode: free[next + r],
        role: 'sample',
        sampleLabel: sample,
      }

      if (options.dilution > 1) well.dilution = options.dilution
      wells.push(well)
    }

    next += replicates
    placed++
  }

  const lines = wells.map((well) =>
    [
      well.wellCode,
      well.role,
      well.sampleLabel ?? '',
      well.role === 'standard' ? String(well.concentration ?? '') : '',
      well.role === 'standard' ? (well.concentrationUnit ?? '') : '',
      well.dilution ? String(well.dilution) : '',
    ].join(','),
  )

  return { wells, text: [LAYOUT_HEADER, ...lines].join('\n'), placed, left }
}
