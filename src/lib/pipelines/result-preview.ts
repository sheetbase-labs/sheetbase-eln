/**
 * A bounded preview of what a run produced, stored on the run's `result` so
 * the run page can show the answer even when the pipeline keeps no Dataset.
 * The full result lives only in the Dataset Version a create/append output
 * writes; this is a look, not a copy.
 */

export const PREVIEW_MAX_ROWS = 50
export const PREVIEW_MAX_COLUMNS = 40
export const PREVIEW_MAX_CELL_CHARS = 200

export type PreviewCell = string | number | boolean | null

export interface ResultPreview {
  columns: string[]
  rows: PreviewCell[][]
  /** Rows the transform produced, including the ones not shown. */
  rowCount: number
  /** True when rows or columns were left out to stay within the preview. */
  truncated: boolean
}

function previewCell(value: unknown): PreviewCell {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'string'
        ? value
        : JSON.stringify(value)
  return text.length > PREVIEW_MAX_CELL_CHARS
    ? `${text.slice(0, PREVIEW_MAX_CELL_CHARS)}…`
    : text
}

export function buildResultPreview(
  rows: ReadonlyArray<Record<string, unknown>>,
): ResultPreview {
  const allColumns = rows[0] ? Object.keys(rows[0]) : []
  const columns = allColumns.slice(0, PREVIEW_MAX_COLUMNS)
  const shown = rows.slice(0, PREVIEW_MAX_ROWS)
  return {
    columns,
    rows: shown.map((row) => columns.map((column) => previewCell(row[column]))),
    rowCount: rows.length,
    truncated:
      rows.length > PREVIEW_MAX_ROWS || allColumns.length > PREVIEW_MAX_COLUMNS,
  }
}

/** The preview a run stored, or null for older runs and shapes we don't know. */
export function readResultPreview(
  result: Record<string, unknown>,
): ResultPreview | null {
  const raw = result.resultPreview
  if (typeof raw !== 'object' || raw === null) return null
  const { columns, rows, rowCount, truncated } = raw as Record<string, unknown>
  if (!Array.isArray(columns) || !Array.isArray(rows)) return null
  if (!columns.every((c) => typeof c === 'string')) return null
  if (!rows.every((r) => Array.isArray(r))) return null
  return {
    columns: columns as string[],
    rows: rows as PreviewCell[][],
    rowCount: typeof rowCount === 'number' ? rowCount : rows.length,
    truncated: truncated === true,
  }
}
