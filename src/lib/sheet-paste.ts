import { detectDelimiter, parseDelimited } from '#/lib/import-parse'

/** A sheet takes at most this many new local columns in one change. */
export const PASTE_MAX_COLUMNS = 32
/** Rows kept from one paste; a sheet is for trying things, not for bulk data. */
export const PASTE_MAX_ROWS = 1_000

export interface PastedTable {
  headers: string[]
  rows: string[][]
  /** Columns or rows beyond the limits that were left out. */
  clipped: { columns: number; rows: number }
}

/**
 * Read text pasted from a spreadsheet or a CSV/TSV file as a table: the first
 * row names the columns, the rest are rows. Returns null when there is no
 * header and at least one row to bring in.
 */
export function parsePastedTable(text: string): PastedTable | null {
  const source = text.replace(/^\uFEFF/, '')
  if (!source.trim()) return null
  let matrix: string[][]
  try {
    matrix = parseDelimited(source, detectDelimiter(source))
  } catch {
    return null
  }
  const usable = matrix.filter((row) => row.some((cell) => cell.trim() !== ''))
  if (usable.length < 2) return null
  const [header = [], ...body] = usable
  const width = Math.min(header.length, PASTE_MAX_COLUMNS)
  const headers = header
    .slice(0, width)
    .map((label, index) => label.trim() || `Column ${index + 1}`)
  const rows = body
    .slice(0, PASTE_MAX_ROWS)
    .map((row) => headers.map((_, index) => row[index] ?? ''))
  return {
    headers,
    rows,
    clipped: {
      columns: header.length - width,
      rows: Math.max(0, body.length - PASTE_MAX_ROWS),
    },
  }
}
