/**
 * Comparing a pipeline run's result with what re-running it produced.
 *
 * Pure: takes the two sets of rows, pairs them and says what was added,
 * removed or changed beyond a tolerance. Rows match when every cell is equal
 * (numbers within the tolerance); what is left over is paired by how many cells
 * still agree, so a row whose one value drifted shows as a changed value, not
 * as a removed row and an added row.
 */

export type DiffRow = Record<string, unknown>

/** A relative tolerance; two numbers agree when they differ by at most this share of the larger. */
export const DEFAULT_REPRODUCE_TOLERANCE = 1e-9

/** How many example changes a reproduction keeps. */
export const MAX_DIFF_EXAMPLES = 200

/** Pairing leftovers is quadratic; beyond this many on a side, they pair in order. */
const MAX_SIMILARITY_PAIRING = 1500

export type DiffCell = string | number | boolean | null

export interface CellChange {
  column: string
  before: DiffCell
  after: DiffCell
}

export type DiffExample =
  | { kind: 'added'; row: Record<string, DiffCell> }
  | { kind: 'removed'; row: Record<string, DiffCell> }
  | {
      kind: 'changed'
      /** The original row's position in the result, from 1. */
      position: number
      row: Record<string, DiffCell>
      cells: CellChange[]
    }

export interface ReproduceDiff {
  originalRows: number
  reproducedRows: number
  matchedRows: number
  addedRows: number
  removedRows: number
  changedRows: number
  changedCells: number
  /** Columns present on one side only. */
  columnsAdded: string[]
  columnsRemoved: string[]
  /** How many rows changed in each column. */
  changedColumns: Record<string, number>
  /** The largest difference seen in each numeric column. */
  largestDelta: Record<string, number>
  examples: DiffExample[]
  /** More changes than the examples hold. */
  truncated: boolean
}

/**
 * Turn any cell into something comparable and JSON-safe. Text stays text: a
 * caller that reads numerics back as strings converts them by column type first.
 */
export function normaliseCell(value: unknown): DiffCell {
  if (value === null || value === undefined) return null

  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  if (typeof value === 'boolean') return value

  if (typeof value === 'bigint') return Number(value)

  if (value instanceof Date) return value.toISOString()

  if (typeof value === 'string') return value

  return JSON.stringify(value)
}

function normaliseRow(row: DiffRow): Record<string, DiffCell> {
  const out: Record<string, DiffCell> = {}

  for (const key of Object.keys(row).sort()) out[key] = normaliseCell(row[key])

  return out
}

export function cellsAgree(
  a: DiffCell,
  b: DiffCell,
  tolerance: number,
): boolean {
  if (a === b) return true

  if (typeof a === 'number' && typeof b === 'number') {
    const scale = Math.max(1, Math.abs(a), Math.abs(b))

    return Math.abs(a - b) <= tolerance * scale
  }

  return false
}

function digitsFor(tolerance: number): number {
  if (!(tolerance > 0)) return 17

  return Math.min(17, Math.max(1, Math.floor(-Math.log10(tolerance))))
}

/** A string two rows share when they agree, so equal rows pair in one pass. */
function rowKey(
  row: Record<string, DiffCell>,
  columns: string[],
  digits: number,
): string {
  return JSON.stringify(
    columns.map((column) => {
      const value = row[column]

      return typeof value === 'number'
        ? Number(value.toPrecision(digits))
        : value
    }),
  )
}

function rowsAgree(
  a: Record<string, DiffCell>,
  b: Record<string, DiffCell>,
  columns: string[],
  tolerance: number,
): boolean {
  return columns.every((column) => cellsAgree(a[column], b[column], tolerance))
}

function agreement(
  a: Record<string, DiffCell>,
  b: Record<string, DiffCell>,
  columns: string[],
  tolerance: number,
): number {
  let score = 0

  for (const column of columns) {
    if (cellsAgree(a[column], b[column], tolerance)) score++
  }

  return score
}

export function diffResultRows(
  original: ReadonlyArray<DiffRow>,
  reproduced: ReadonlyArray<DiffRow>,
  tolerance: number = DEFAULT_REPRODUCE_TOLERANCE,
): ReproduceDiff {
  const before = original.map(normaliseRow)
  const after = reproduced.map(normaliseRow)
  const beforeColumns = new Set(before.flatMap((row) => Object.keys(row)))
  const afterColumns = new Set(after.flatMap((row) => Object.keys(row)))

  const shared = [...beforeColumns]
    .filter((column) => afterColumns.has(column))
    .sort()

  const columnsRemoved = [...beforeColumns]
    .filter((column) => !afterColumns.has(column))
    .sort()

  const columnsAdded = [...afterColumns]
    .filter((column) => !beforeColumns.has(column))
    .sort()

  const digits = digitsFor(tolerance)

  // Pass 1: rows that agree exactly (within rounding) pair off.
  const pool = new Map<string, number[]>()
  after.forEach((row, index) => {
    const key = rowKey(row, shared, digits)
    const list = pool.get(key)

    if (list) list.push(index)
    else pool.set(key, [index])
  })
  const usedAfter = new Set<number>()
  const leftoverBefore: number[] = []
  let matched = 0
  before.forEach((row, index) => {
    const candidates = pool.get(rowKey(row, shared, digits))

    const found = candidates?.find(
      (candidate) =>
        !usedAfter.has(candidate) &&
        rowsAgree(row, after[candidate], shared, tolerance),
    )

    if (found === undefined) {
      leftoverBefore.push(index)

      return
    }

    usedAfter.add(found)
    matched++
  })

  const leftoverAfter = after
    .map((_, index) => index)
    .filter((index) => !usedAfter.has(index))

  // Pass 2: pair what is left by how much of the row still agrees.
  const pairs: Array<[number, number]> = []
  const freeAfter = new Set(leftoverAfter)

  if (
    leftoverBefore.length <= MAX_SIMILARITY_PAIRING &&
    leftoverAfter.length <= MAX_SIMILARITY_PAIRING
  ) {
    for (const i of leftoverBefore) {
      let best = -1
      let bestScore = 0

      for (const j of freeAfter) {
        const score = agreement(before[i], after[j], shared, tolerance)

        if (score > bestScore) {
          best = j
          bestScore = score
        }
      }

      // Rows with nothing in common are a removal and an addition.
      if (best >= 0 && bestScore * 2 >= shared.length) {
        pairs.push([i, best])
        freeAfter.delete(best)
      }
    }
  } else {
    const rest = [...freeAfter]
    leftoverBefore
      .slice(0, rest.length)
      .forEach((i, k) => pairs.push([i, rest[k]]))

    for (const [, j] of pairs) freeAfter.delete(j)
  }

  const pairedBefore = new Set(pairs.map(([i]) => i))

  const examples: DiffExample[] = []
  const changedColumns: Record<string, number> = {}
  const largestDelta: Record<string, number> = {}
  let changedRows = 0
  let changedCells = 0
  let removedRows = 0
  let addedRows = 0
  let truncated = false

  const keep = (example: DiffExample) => {
    if (examples.length < MAX_DIFF_EXAMPLES) examples.push(example)
    else truncated = true
  }

  for (const [i, j] of pairs.sort((a, b) => a[0] - b[0])) {
    const cells: CellChange[] = []

    for (const column of shared) {
      const a = before[i][column]
      const b = after[j][column]

      if (cellsAgree(a, b, tolerance)) continue
      cells.push({ column, before: a, after: b })
      changedColumns[column] = (changedColumns[column] ?? 0) + 1

      if (typeof a === 'number' && typeof b === 'number') {
        largestDelta[column] = Math.max(
          largestDelta[column] ?? 0,
          Math.abs(a - b),
        )
      }
    }

    if (cells.length === 0) {
      matched++
      continue
    }

    changedRows++
    changedCells += cells.length
    keep({ kind: 'changed', position: i + 1, row: before[i], cells })
  }

  for (const i of leftoverBefore) {
    if (pairedBefore.has(i)) continue
    removedRows++
    keep({ kind: 'removed', row: before[i] })
  }

  for (const j of freeAfter) {
    addedRows++
    keep({ kind: 'added', row: after[j] })
  }

  return {
    originalRows: before.length,
    reproducedRows: after.length,
    matchedRows: matched,
    addedRows,
    removedRows,
    changedRows,
    changedCells,
    columnsAdded,
    columnsRemoved,
    changedColumns,
    largestDelta,
    examples,
    truncated,
  }
}

/** Matches means nothing differs: no rows, cells or columns. */
export function diffMatches(diff: ReproduceDiff): boolean {
  return (
    diff.addedRows === 0 &&
    diff.removedRows === 0 &&
    diff.changedRows === 0 &&
    diff.columnsAdded.length === 0 &&
    diff.columnsRemoved.length === 0
  )
}
