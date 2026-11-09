import {
  parseDelimited,
  detectDelimiter,
  readXlsxMatrices,
} from '../import-parse'
import { openArchive, parseXml, partText } from './zip'

/** One worksheet, cut to what a preview shows. */
export interface PreviewSheet {
  name: string
  rows: string[][]
  /** Rows and columns the sheet really has, before the cut. */
  totalRows: number
  totalColumns: number
}

export interface SheetLimits {
  rows: number
  columns: number
}

export const INLINE_SHEET_LIMITS: SheetLimits = { rows: 200, columns: 30 }
export const EXPANDED_SHEET_LIMITS: SheetLimits = { rows: 2000, columns: 100 }

function cut(
  name: string,
  matrix: string[][],
  limits: SheetLimits,
): PreviewSheet {
  const totalColumns = matrix.reduce((n, row) => Math.max(n, row.length), 0)

  const rows = matrix
    .slice(0, limits.rows)
    .map((row) => row.slice(0, limits.columns))

  return { name, rows, totalRows: matrix.length, totalColumns }
}

export function readCsvSheets(
  bytes: Uint8Array,
  limits: SheetLimits,
): PreviewSheet[] {
  const decoded = new TextDecoder('utf-8').decode(bytes)
  const text = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded
  const matrix = parseDelimited(text, detectDelimiter(text))

  while (matrix.length > 0 && matrix[matrix.length - 1]?.every((c) => !c)) {
    matrix.pop()
  }

  return [cut('CSV', matrix, limits)]
}

export async function readXlsxSheets(
  bytes: Uint8Array,
  limits: SheetLimits,
): Promise<PreviewSheet[]> {
  const copy = bytes.slice().buffer
  const sheets = await readXlsxMatrices(copy)

  return sheets.map((s) => cut(s.name, s.matrix, limits))
}

const TABLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0'
const TEXT_NS = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'

/** The most blank rows or columns a repeat count is allowed to add. */
const REPEAT_CAP = 50

function cellText(cell: Element): string {
  const paragraphs = Array.from(cell.getElementsByTagNameNS(TEXT_NS, 'p'))

  return paragraphs.map((p) => p.textContent).join('\n')
}

export function readOdsSheets(
  bytes: Uint8Array,
  limits: SheetLimits,
): PreviewSheet[] {
  const archive = openArchive(bytes, (n) => n === 'content.xml')
  const xml = partText(archive, 'content.xml')

  if (!xml) throw new Error('The spreadsheet has no content.')
  const doc = parseXml(xml)
  const sheets: PreviewSheet[] = []

  for (const table of Array.from(
    doc.getElementsByTagNameNS(TABLE_NS, 'table'),
  )) {
    const name =
      table.getAttributeNS(TABLE_NS, 'name') ?? `Sheet ${sheets.length + 1}`

    const matrix: string[][] = []

    for (const row of Array.from(table.childNodes)) {
      if (!(row instanceof Element) || row.localName !== 'table-row') continue

      const rowRepeat = Number(
        row.getAttributeNS(TABLE_NS, 'number-rows-repeated') ?? 1,
      )

      const cells: string[] = []

      for (const cell of Array.from(row.childNodes)) {
        if (!(cell instanceof Element)) continue

        if (
          cell.localName !== 'table-cell' &&
          cell.localName !== 'covered-table-cell'
        )
          continue
        const text = cell.localName === 'table-cell' ? cellText(cell) : ''

        const repeat = Number(
          cell.getAttributeNS(TABLE_NS, 'number-columns-repeated') ?? 1,
        )

        const times = text ? Math.min(repeat, REPEAT_CAP) : Math.min(repeat, 1)

        for (let i = 0; i < times; i++) cells.push(text)

        if (!text && repeat > 1 && repeat < REPEAT_CAP) {
          for (let i = 1; i < repeat; i++) cells.push('')
        }
      }

      while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
      const times = cells.length === 0 ? 1 : Math.min(rowRepeat, REPEAT_CAP)

      for (let i = 0; i < times; i++) matrix.push(cells)

      if (matrix.length > limits.rows * 4) break
    }

    while (matrix.length > 0 && matrix[matrix.length - 1]?.length === 0) {
      matrix.pop()
    }

    sheets.push(cut(name, matrix, limits))
  }

  if (sheets.length === 0) throw new Error('The spreadsheet has no sheets.')

  return sheets
}
