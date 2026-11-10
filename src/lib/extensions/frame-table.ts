/**
 * The table a plugin screen asks Sheetbase to draw (`sheetbase.table(...)`).
 *
 * The screen sends data; this keeps only the shapes Sheetbase draws, so no
 * plugin code runs in a cell: text is cut to length, SVG goes through the same
 * sanitizer as every plugin SVG, a picture must be a base64 data address, and a
 * link must be a same-site path.
 */
import { z } from 'zod'

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

const cellInput = z
  .object({
    text: z.string().optional().catch(undefined),
    svg: z.string().optional().catch(undefined),
    image: z.string().regex(IMAGE_RE).optional().catch(undefined),
    href: z
      .string()
      .max(500)
      .regex(INTERNAL_PATH_RE)
      .optional()
      .catch(undefined),
    shade: z.number().optional().catch(undefined),
    sort: z
      .union([
        z.string().transform((value) => value.slice(0, 200)),
        z.number(),
        z.null(),
      ])
      .optional()
      .catch(undefined),
  })
  .catch({})

const columnInput = z.object({
  key: z.string(),
  label: z.string(),
  align: z.literal('right').optional().catch(undefined),
})

const rowInput = z.object({
  id: z.string(),
  cells: z.record(z.string(), z.unknown()),
})

const tableInput = z.object({
  columns: z.array(z.unknown()),
  rows: z.array(z.unknown()),
  sort: z
    .object({
      key: z.string(),
      descending: z.boolean().catch(false),
    })
    .optional()
    .catch(undefined),
  empty: z.string().optional().catch(undefined),
})

function checkCell(raw: z.infer<typeof cellInput>): FrameTableCell {
  const cell: FrameTableCell = {}

  if (raw.text !== undefined)
    cell.text = raw.text.slice(0, FRAME_TABLE_LIMITS.text)

  if (raw.svg !== undefined) {
    const clean = sanitizeSvg(raw.svg)

    if (clean) cell.svg = clean
  }

  if (raw.image !== undefined) cell.image = raw.image

  if (raw.href !== undefined) cell.href = raw.href

  if (raw.shade !== undefined) cell.shade = Math.min(1, Math.max(0, raw.shade))

  if (raw.sort !== undefined) cell.sort = raw.sort

  return cell
}

/** The table a screen sent, or null when it is not one (or the screen cleared it). */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This receives sandbox messages; table/row/column/cell schemas drop malformed parts before anything reaches the renderer (frame-table.test.ts).
export function checkFrameTable(raw: unknown): FrameTable | null {
  const parsed = tableInput.safeParse(raw)

  if (!parsed.success) return null

  const input = parsed.data
  const columns: FrameTable['columns'] = []

  for (const candidate of input.columns.slice(0, FRAME_TABLE_LIMITS.columns)) {
    const column = columnInput.safeParse(candidate)

    if (!column.success) continue
    const c = column.data

    const out: FrameTable['columns'][number] = {
      key: c.key.slice(0, 80),
      label: c.label.slice(0, 80),
    }

    if (c.align) out.align = c.align
    columns.push(out)
  }

  if (columns.length === 0) return null
  const rows: FrameTable['rows'] = []

  for (const candidate of input.rows.slice(0, FRAME_TABLE_LIMITS.rows)) {
    const row = rowInput.safeParse(candidate)

    if (!row.success) continue
    const r = row.data
    const cells: Record<string, FrameTableCell> = {}

    for (const column of columns)
      cells[column.key] = checkCell(cellInput.parse(r.cells[column.key]))
    rows.push({ id: r.id.slice(0, 80), cells })
  }

  const table: FrameTable = { columns, rows }

  if (input.sort) table.sort = input.sort

  if (input.empty !== undefined) table.empty = input.empty.slice(0, 200)

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
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- These are checked cell sort values, not raw messages. Both numbers use arithmetic (including negative values); mixed/text values retain locale numeric ordering. frame-table.test.ts distinguishes negative numeric order from string collation.
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), undefined, { numeric: true })

    return sort.descending ? -order : order
  })
}
