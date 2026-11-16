/**
 * Does a worksheet look like a microplate read-out? Plate readers export two
 * shapes: a grid (row letters down the side, column numbers across the top) and
 * a list with one row per well (`A1`, `A2` ...). Either way the file can be a
 * plate run as well as a plain table, so the import offers both.
 */
import type { ImportSheetPreview } from '#/lib/import/types'

/** Plate formats by wells: rows by columns. */
const FORMATS: ReadonlyArray<{ wells: number; rows: number; columns: number }> =
  [
    { wells: 6, rows: 2, columns: 3 },
    { wells: 12, rows: 3, columns: 4 },
    { wells: 24, rows: 4, columns: 6 },
    { wells: 48, rows: 6, columns: 8 },
    { wells: 96, rows: 8, columns: 12 },
    { wells: 384, rows: 16, columns: 24 },
  ]

export interface PlateGridGuess {
  /** `grid` has the plate laid out as it sits; `list` has one row per well. */
  layout: 'grid' | 'list'
  wells: number
  rows: number
  columns: number
}

const ROW_LETTERS = 'ABCDEFGHIJKLMNOP'
const WELL = /^([A-P])(\d{1,2})$/i

/** A cell by header, empty when the row has none. */
function cell(row: Record<string, string>, header: string): string {
  return Object.hasOwn(row, header) ? row[header].trim() : ''
}

function formatFor(rows: number, columns: number): PlateGridGuess | null {
  const match = FORMATS.find(
    (format) => format.rows === rows && format.columns === columns,
  )

  return match
    ? {
        layout: 'grid',
        wells: match.wells,
        rows: match.rows,
        columns: match.columns,
      }
    : null
}

function gridGuess(sheet: ImportSheetPreview): PlateGridGuess | null {
  const [corner, ...rest] = sheet.headers
  const numbers = rest.map((header) => Number(header.trim()))

  const consecutive =
    rest.length >= 3 &&
    numbers.every(
      (value, index) => Number.isInteger(value) && value === index + 1,
    )

  if (!consecutive) return null

  const letters = sheet.sampleRows.map((row) => cell(row, corner))
  const lettered = letters.filter((value) => /^[A-P]$/i.test(value))

  // The first column holds A, B, C ... in order, with nothing else among them.
  if (
    lettered.length === 0 ||
    lettered.length !== letters.length ||
    lettered.some((value, index) => value.toUpperCase() !== ROW_LETTERS[index])
  )
    return null

  // Sample rows are capped, so the full count comes from the sheet.
  const rows = Math.min(sheet.rowCount, ROW_LETTERS.length)

  return formatFor(rows, rest.length)
}

function listGuess(sheet: ImportSheetPreview): PlateGridGuess | null {
  const wellHeader = sheet.headers.find((header) =>
    /^(well|well\s*(id|name|position|label))$/i.test(header.trim()),
  )

  if (!wellHeader) return null

  const wells = sheet.sampleRows
    .map((row) => WELL.exec(cell(row, wellHeader)))
    .filter((match): match is RegExpExecArray => match !== null)

  if (wells.length === 0 || wells.length !== sheet.sampleRows.length)
    return null

  const format = FORMATS.find((item) => item.wells === sheet.rowCount)

  if (!format) return null

  return {
    layout: 'list',
    wells: format.wells,
    rows: format.rows,
    columns: format.columns,
  }
}

/** The plate this worksheet looks like, or null when it is an ordinary table. */
export function detectPlateGrid(
  sheet: ImportSheetPreview,
): PlateGridGuess | null {
  return gridGuess(sheet) ?? listGuess(sheet)
}
