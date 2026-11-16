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
import type { ImportDelimiter } from '#/lib/import-parse'
import {
  ImportParseError,
  detectDelimiter,
  matrixToCsv,
  parseDelimited,
  readXlsxMatrices,
} from '#/lib/import-parse'
import { inferPlateFormat, parsePlateTable } from '#/lib/plate-assay'
import { FORMAT_DIMENSIONS, PLATE_FORMATS } from '#/lib/plate-map'
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

const THOUSANDS = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/
const DECIMAL_COMMA = /^-?\d+,\d+$/
const DECIMAL_COMMA_THOUSANDS = /^-?\d{1,3}(\.\d{3})+,\d+$/
const DECIMAL_POINT = /^-?\d+\.\d+$/

/**
 * Write every number the way `Number` reads it. A file separated by commas
 * keeps "1,234" for a thousand; one separated by semicolons or tabs that
 * writes "1234,5" is using a decimal comma. Without this a reading of 44,210
 * would be read as 44.21.
 */
export function normaliseNumbers(
  matrix: string[][],
  delimiter: ImportDelimiter,
): string[][] {
  const cells = matrix.flat()

  const decimalComma =
    delimiter !== ',' &&
    cells.some(
      (c) => DECIMAL_COMMA.test(c) || DECIMAL_COMMA_THOUSANDS.test(c),
    ) &&
    !cells.some((c) => DECIMAL_POINT.test(c))

  return matrix.map((row) =>
    row.map((cell) => {
      if (decimalComma) {
        if (DECIMAL_COMMA_THOUSANDS.test(cell))
          return cell.replaceAll('.', '').replace(',', '.')

        return DECIMAL_COMMA.test(cell) ? cell.replace(',', '.') : cell
      }

      return THOUSANDS.test(cell) ? cell.replaceAll(',', '') : cell
    }),
  )
}

/** The name a reader printed above a plate: its plate name, barcode or label line. */
function titleAbove(matrix: string[][], index: number): string | null {
  const found = new Map<string, string>()

  for (let up = index - 1; up >= Math.max(0, index - 10); up--) {
    const row = matrix[up]

    const named =
      /^(plate id|plate name|plate|barcode|label|id1)\s*:?\s*(.*)$/i.exec(
        (row[0] ?? '').trim(),
      )

    if (!named) continue
    const value = named[2].trim() || (row[1] ?? '').trim()
    const kind = named[1].toLowerCase()

    if (value && !found.has(kind)) found.set(kind, value)
  }

  for (const kind of [
    'plate name',
    'plate id',
    'plate',
    'barcode',
    'id1',
    'label',
  ])
    if (found.has(kind)) return found.get(kind) ?? null

  return null
}

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

/** Rows of a plate with this many columns, when the readers print no row letters. */
function rowsForColumns(width: number): number | null {
  const format = PLATE_FORMATS.find((f) => FORMAT_DIMENSIONS[f].cols === width)

  return format ? FORMAT_DIMENSIONS[format].rows : null
}

interface PlateBody {
  body: string[][]
  next: number
}

/**
 * The lettered rows under a column-number header. Some readers (SoftMax Pro,
 * for one) print the readings with no row letters, only a temperature or blank
 * column in front: when the rows are numbers and there are exactly as many as a
 * plate that wide has, they are A, B, C … in order.
 */
function bodyUnder(
  matrix: string[][],
  index: number,
  start: number,
  width: number,
): PlateBody {
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

  if (body.length >= 2) return { body, next }

  const expected = rowsForColumns(width)
  const unlabeled: string[][] = []
  next = index + 1

  while (
    expected !== null &&
    next < matrix.length &&
    unlabeled.length < expected &&
    matrix[next].slice(start, start + width).filter(isNumberCell).length >=
      width / 2
  ) {
    unlabeled.push([
      String.fromCharCode(65 + unlabeled.length),
      ...matrix[next].slice(start, start + width),
    ])
    next++
  }

  return unlabeled.length === expected
    ? { body: unlabeled, next }
    : { body, next: index + 1 }
}

/** Every grid in a sheet: a column-number header with lettered rows under it. */
export function plateGridsFromMatrix(
  matrix: string[][],
  sheetName: string,
): PlateCandidate[] {
  const found: PlateCandidate[] = []
  const titles: Array<string | null> = []
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

    const { body, next } = bodyUnder(matrix, index, start, width)

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
        titles.push(titleAbove(matrix, index))
      }
    }

    index = Math.max(next, index + 1)
  }

  // Name each of several plates by what the reader printed above it, when
  // those names tell them apart.
  if (
    found.length > 1 &&
    titles.every(Boolean) &&
    new Set(titles).size === found.length
  )
    return found.map((grid, i) => ({
      ...grid,
      label: `${sheetName} · ${titles[i]}`,
    }))

  return found
}

const WELL_HEADERS = new Set(['well', 'wellcode', 'position', 'wellposition'])

const PLATE_HEADERS = new Set([
  'plate',
  'plateid',
  'platename',
  'platenumber',
  'plateno',
  'platebarcode',
  'barcode',
])

const headerKey = (cell: string) => cell.toLowerCase().replace(/[\s_-]+/g, '')

/**
 * A list with a `well` column, wherever its header is in the sheet. When it
 * also has a plate or barcode column holding several values, each plate is its
 * own candidate: one list file from a screen holds many plates.
 */
function plateListsFromMatrix(
  matrix: string[][],
  sheetName: string,
): PlateCandidate[] {
  const headerAt = matrix.findIndex((row) =>
    row.some((cell) => WELL_HEADERS.has(headerKey(cell))),
  )

  if (headerAt < 0) return []
  const rows = matrix.slice(headerAt)
  const header = rows[0].map(headerKey)
  const plateCol = header.findIndex((h) => PLATE_HEADERS.has(h))

  const groups = new Map<string, string[][]>()

  if (plateCol >= 0) {
    for (const row of rows.slice(1)) {
      const key = (row[plateCol] ?? '').trim()

      if (key === '') continue
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
  }

  if (groups.size < 2) groups.clear()

  if (groups.size === 0) groups.set('', rows.slice(1))

  const found: PlateCandidate[] = []

  for (const [key, body] of groups) {
    const text = matrixToCsv([rows[0], ...body])
    const parsed = parsePlateTable(text)

    const readings = Object.values(parsed.readout).filter(
      (v) => v !== null,
    ).length

    if (parsed.wells.length === 0 || readings === 0) continue

    found.push({
      id: `${sheetName}#list${key ? `:${key}` : ''}`,
      label: key ? `${sheetName} · ${key}` : sheetName,
      text,
      readings,
      format: parsed.format,
      layout: 'list',
    })
  }

  return found
}

/** Plates in one sheet: grids first, otherwise the sheet as a list. */
export function platesInMatrix(
  matrix: string[][],
  sheetName: string,
): PlateCandidate[] {
  const grids = plateGridsFromMatrix(matrix, sheetName)

  if (grids.length === 0) return plateListsFromMatrix(matrix, sheetName)

  if (grids.length <= 1) return grids

  // Named by the reader's own titles when it printed them, else numbered.
  return grids.every((grid) => grid.label !== sheetName)
    ? grids
    : grids.map((grid, i) => ({ ...grid, label: `${sheetName} · ${i + 1}` }))
}

/**
 * Plates in text a reader exported as CSV, tab- or semicolon-separated. The
 * separator is the one that finds the most plates: a Tecan preamble full of
 * commas does not make the file comma separated.
 */
export function platesInText(text: string, name = 'File'): PlateCandidate[] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const guess = detectDelimiter(clean)

  const delimiters: ImportDelimiter[] = [
    guess,
    ...(['\t', ';', ','] as const).filter((d) => d !== guess),
  ]

  let best: PlateCandidate[] = []
  let bestReadings = 0

  for (const delimiter of delimiters) {
    let found: PlateCandidate[]

    try {
      found = platesInMatrix(
        normaliseNumbers(
          parseDelimited(clean, delimiter).map((row) =>
            row.map((cell) => cell.trim()),
          ),
          delimiter,
        ),
        name,
      )
    } catch (error) {
      // A separator the file does not use can make its quotes unreadable.
      if (error instanceof ImportParseError) continue
      throw error
    }

    const readings = found.reduce((sum, c) => sum + c.readings, 0)

    if (readings > bestReadings) {
      best = found
      bestReadings = readings
    }
  }

  return best
}

/**
 * Text from a reader file's bytes. Readers write UTF-16 (SoftMax Pro, BMG), UTF-8
 * with or without a byte order mark, or Windows-1252 (a Tecan degree sign).
 */
export function decodePlateText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))

  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
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

  const text = decodePlateText(new Uint8Array(buffer))

  return {
    fileName: file.name,
    source: 'text',
    candidates: platesInText(text, file.name),
  }
}
