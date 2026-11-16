/**
 * Spotting the control columns of a plate nobody labelled.
 *
 * A reader's grid has no roles, but screens put their controls down the first
 * and last columns: one column of "no effect" wells, one of "full effect".
 * Those two columns read as two tight groups far apart from each other, while
 * two columns of ordinary samples do not. When the first and last columns do,
 * they are offered as the controls so the plate gets its Z′ and hits without
 * anyone typing 1 and 12.
 */
import { parseWellCode } from '#/lib/plate-map'
import type { PlateReadout } from '#/lib/plate-assay'

export interface ControlColumnGuess {
  /** The "no effect" column: the one that reads closer to the samples. */
  negative: string
  /** The "full effect" column. */
  positive: string
  /** Z′ from these two columns alone, as a first look. */
  zPrime: number
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1

  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Spread that a stray hit or a failed well does not stretch. */
function robustSpread(values: number[]): number {
  const centre = median(values)

  return 1.4826 * median(values.map((v) => Math.abs(v - centre)))
}

/** The control columns a plate's first and last columns look like, if any. */
export function suggestControlColumns(
  readout: PlateReadout,
): ControlColumnGuess | null {
  const byColumn = new Map<number, number[]>()

  for (const [code, value] of Object.entries(readout)) {
    const well = parseWellCode(code)

    if (!well || value === null || !Number.isFinite(value)) continue
    byColumn.set(well.col, [...(byColumn.get(well.col) ?? []), value])
  }

  const columns = [...byColumn.keys()].sort((a, b) => a - b)

  if (columns.length < 4) return null
  const first = columns[0]
  const last = columns[columns.length - 1]
  const a = byColumn.get(first) ?? []
  const b = byColumn.get(last) ?? []

  if (a.length < 3 || b.length < 3) return null

  const interior = columns
    .slice(1, -1)
    .flatMap((column) => byColumn.get(column) ?? [])

  if (interior.length === 0) return null
  const ma = median(a)
  const mb = median(b)
  const gap = Math.abs(ma - mb)
  const spreadSum = robustSpread(a) + robustSpread(b)

  // Z′ above 0.3 means the two groups are plainly apart; samples are not.
  const zPrime = gap === 0 ? -1 : 1 - (3 * spreadSum) / gap

  if (zPrime < 0.3) return null
  const centre = median(interior)
  const negativeIsFirst = Math.abs(ma - centre) <= Math.abs(mb - centre)

  return {
    negative: String((negativeIsFirst ? first : last) + 1),
    positive: String((negativeIsFirst ? last : first) + 1),
    zPrime,
  }
}
