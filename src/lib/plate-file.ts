/**
 * Reading a plate out of a file a plate reader wrote.
 *
 * Readers export a CSV or an Excel workbook with a preamble (protocol, date,
 * temperature) and then one or more grids: a header of column numbers, rows
 * labelled A, B, C…, one reading per well. Some write a list instead, one line
 * per well. This finds every plate in the file and hands each one back as the
 * plain grid or list text `parsePlateTable` reads, so the plate run dialog can
 * show what each would become before anything is saved.
 */
import {
  ImportParseError,
  detectDelimiter,
  matrixToCsv,
  parseDelimited,
  readXlsxMatrices,
} from '#/lib/import-parse'
import { inferPlateFormat, parsePlateTable } from '#/lib/plate-assay'
import type { PlateFormat } from '#/lib/plate-map'

/** One plate found in a file. */
export interface PlateCandidate {
  id: string
  /** Where it was found: a sheet name, or a position in the sheet. */
  label: string
  /** The grid or list as text, ready for `parsePlateTable`. */
  text: string
  /** How many wells hold a reading. */
  readings: number
  format: PlateFormat | null
  /** A grid (one reading per cell) or a list (one line per well). */
  layout: 'grid' | 'list'
}

export interface PlateFileRead {
  fileName: string
  source: 'text' | 'workbook'
  candidates: PlateCandidate[]
}

const ROW_LABEL = /^[A-Za-z]{1,2}$/

/** The largest file read here: a plate is a few thousand numbers, not a dataset. */
export const PLATE_FILE_MAX_BYTES = 8 * 1024 * 1024

const isNumberCell = (cell: string | undefined) =>
  cell !== undefined && cell.trim() !== '' && Number.isFinite(Number(cell))

/** Does a row hold 1, 2, 3 … n (n at least 3) starting at this column? */
function columnNumbersAt(row: string[], from: number): number {
  let count = 0

  while (
    Number(row[from + count]) === count + 1 &&
    isNumberCell(row[from + count])
  )
    count++

  return count >= 3 ? count : 0
}

/** Every grid in a sheet: a column-number header with lettered rows under it. */
export function plateGridsFromMatrix(
  matrix: string[][],
  sheetName: string,
): PlateCandidate[] {
  const found: PlateCandidate[] = []
  let index = 0

  while (index < matrix.length) {
    const row = matrix[index]
    let start = -1
    let width = 0

    for (let col = 1; col < row.length && start < 0; col++) {
      const n = columnNumbersAt(row, col)

      if (n > 0) {
        start = col
        width = n
      }
    }

    if (start < 0) {
      index++
      continue
    }

    const body: string[][] = []
    let next = index + 1

    while (
      next < matrix.length &&
      ROW_LABEL.test(matrix[next][start - 1] ?? '')
    ) {
      body.push([
        matrix[next][start - 1].trim().toUpperCase(),
        ...matrix[next].slice(start, start + width),
      ])
      next++
    }

    if (body.length >= 2) {
      const header = [
        '',
        ...Array.from({ length: width }, (_, i) => String(i + 1)),
      ]

      const text = matrixToCsv([header, ...body])

      const parsed = parsePlateTable(text)

      const readings = Object.values(parsed.readout).filter(
        (v) => v !== null,
      ).length

      if (readings > 0) {
        found.push({
          id: `${sheetName}#${found.length + 1}`,
          label: sheetName,
          text,
          readings,
          format: inferPlateFormat(parsed.wells.map((w) => w.wellCode)),
          layout: 'grid',
        })
      }
    }

    index = Math.max(next, index + 1)
  }

  return found
}

/** A list with a `well` column, as a whole sheet. */
function plateListFromMatrix(
  matrix: string[][],
  sheetName: string,
): PlateCandidate | null {
  const text = matrixToCsv(matrix)
  const parsed = parsePlateTable(text)

  const readings = Object.values(parsed.readout).filter(
    (v) => v !== null,
  ).length

  if (parsed.wells.length === 0 || readings === 0) return null

  return {
    id: `${sheetName}#list`,
    label: sheetName,
    text,
    readings,
    format: parsed.format,
    layout: 'list',
  }
}

/** Plates in one sheet: grids first, otherwise the sheet as a list. */
export function platesInMatrix(
  matrix: string[][],
  sheetName: string,
): PlateCandidate[] {
  const list = plateListFromMatrix(matrix, sheetName)

  if (list) return [list]

  const grids = plateGridsFromMatrix(matrix, sheetName)

  if (grids.length <= 1) return grids

  return grids.map((grid, i) => ({
    ...grid,
    label: `${sheetName} · ${i + 1}`,
  }))
}

/** Plates in text a reader exported as CSV, tab- or semicolon-separated. */
export function platesInText(text: string, name = 'File'): PlateCandidate[] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  const matrix = parseDelimited(clean, detectDelimiter(clean)).map((row) =>
    row.map((cell) => cell.trim()),
  )

  return platesInMatrix(matrix, name)
}

function isWorkbook(name: string, bytes: Uint8Array): boolean {
  if (/\.xlsx$/i.test(name)) return true

  return (
    bytes.length > 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  )
}

/**
 * Read a plate reader file: a CSV, TSV or text export, or an Excel workbook.
 * Throws an `ImportParseError` with words for the person when the file is
 * unreadable or holds no plate.
 */
export async function readPlateFile(file: File): Promise<PlateFileRead> {
  if (file.size > PLATE_FILE_MAX_BYTES)
    throw new ImportParseError('That file is too large to be a plate.')

  if (/\.xls$/i.test(file.name))
    throw new ImportParseError(
      'Old .xls files can’t be read. Save the sheet as .xlsx or .csv and try again.',
    )

  const buffer = await file.arrayBuffer()

  if (isWorkbook(file.name, new Uint8Array(buffer))) {
    const sheets = await readXlsxMatrices(buffer)
    const candidates = sheets.flatMap((s) => platesInMatrix(s.matrix, s.name))

    return { fileName: file.name, source: 'workbook', candidates }
  }

  const text = new TextDecoder('utf-8').decode(buffer)

  return {
    fileName: file.name,
    source: 'text',
    candidates: platesInText(text, file.name),
  }
}
