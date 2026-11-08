/**
 * The table a plugin screen asks Sheetbase to draw (`sheetbase.table(...)`).
 *
 * The screen sends data; this keeps only the shapes Sheetbase draws, so no
 * plugin code runs in a cell: text is cut to length, SVG goes through the same
 * sanitizer as every plugin SVG, a picture must be a base64 data address, and a
 * link must be a same-site path.
 */
import { sanitizeSvg } from './screens'

export interface FrameTableCell {
  text?: string
  svg?: string
  image?: string
  href?: string
  shade?: number
  sort?: number | string | null
}
export interface FrameTable {
  columns: { key: string; label: string; align?: 'right' }[]
  rows: { id: string; cells: Record<string, FrameTableCell> }[]
  sort?: { key: string; descending: boolean }
  empty?: string
}

export const FRAME_TABLE_LIMITS = { columns: 40, rows: 5000, text: 500 }

const IMAGE_RE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/
const INTERNAL_PATH_RE = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*$/

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function checkCell(raw: unknown): FrameTableCell {
  if (!isObject(raw)) return {}
  const cell: FrameTableCell = {}
  if (typeof raw.text === 'string')
    cell.text = raw.text.slice(0, FRAME_TABLE_LIMITS.text)
  if (typeof raw.svg === 'string') {
    const clean = sanitizeSvg(raw.svg)
    if (clean) cell.svg = clean
  }
  if (typeof raw.image === 'string' && IMAGE_RE.test(raw.image))
    cell.image = raw.image
  if (
    typeof raw.href === 'string' &&
    raw.href.length <= 500 &&
    INTERNAL_PATH_RE.test(raw.href)
  )
    cell.href = raw.href
  if (typeof raw.shade === 'number' && Number.isFinite(raw.shade))
    cell.shade = Math.min(1, Math.max(0, raw.shade))
  if (
    raw.sort === null ||
    typeof raw.sort === 'string' ||
    (typeof raw.sort === 'number' && Number.isFinite(raw.sort))
  )
    cell.sort = typeof raw.sort === 'string' ? raw.sort.slice(0, 200) : raw.sort
  return cell
}

/** The table a screen sent, or null when it is not one (or the screen cleared it). */
export function checkFrameTable(raw: unknown): FrameTable | null {
  if (!isObject(raw) || !Array.isArray(raw.columns) || !Array.isArray(raw.rows))
    return null
  const columns: FrameTable['columns'] = []
  for (const c of raw.columns.slice(0, FRAME_TABLE_LIMITS.columns)) {
    if (
      !isObject(c) ||
      typeof c.key !== 'string' ||
      typeof c.label !== 'string'
    )
      continue
    columns.push({
      key: c.key.slice(0, 80),
      label: c.label.slice(0, 80),
      ...(c.align === 'right' ? { align: 'right' as const } : {}),
    })
  }
  if (columns.length === 0) return null
  const rows: FrameTable['rows'] = []
  for (const r of raw.rows.slice(0, FRAME_TABLE_LIMITS.rows)) {
    if (!isObject(r) || typeof r.id !== 'string' || !isObject(r.cells)) continue
    const cells: Record<string, FrameTableCell> = {}
    for (const column of columns)
      cells[column.key] = checkCell(r.cells[column.key])
    rows.push({ id: r.id.slice(0, 80), cells })
  }
  const table: FrameTable = { columns, rows }
  if (isObject(raw.sort) && typeof raw.sort.key === 'string')
    table.sort = {
      key: raw.sort.key,
      descending: raw.sort.descending === true,
    }
  if (typeof raw.empty === 'string') table.empty = raw.empty.slice(0, 200)
  return table
}

const sortValue = (cell: FrameTableCell): number | string | null => {
  if (cell.sort !== undefined) return cell.sort
  return cell.text === undefined || cell.text === '' ? null : cell.text
}

/** The rows in sort order; a row with no value for the column goes last either way. */
export function sortFrameRows(
  rows: FrameTable['rows'],
  sort: { key: string; descending: boolean } | null,
): FrameTable['rows'] {
  if (!sort) return rows
  return [...rows].sort((a, b) => {
    const x = sortValue(a.cells[sort.key] ?? {})
    const y = sortValue(b.cells[sort.key] ?? {})
    if (x === y) return 0
    if (x === null) return 1
    if (y === null) return -1
    const order =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), undefined, { numeric: true })
    return sort.descending ? -order : order
  })
}
