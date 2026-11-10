/**
 * A bounded preview of what a run produced, stored on the run's `result` so
 * the run page can show the answer even when the pipeline keeps no Dataset.
 * The full result lives only in the Dataset Version a create/append output
 * writes; this is a look, not a copy.
 */

import { z } from 'zod'

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

const previewCellSchema = z.union([
  z
    .null()
    .optional()
    .transform(() => null),
  z.number(),
  z
    .union([z.nan(), z.literal(Infinity), z.literal(-Infinity)])
    .transform(() => null),
  z.boolean(),
  z
    .union([
      z.date().transform((value) => value.toISOString()),
      z.string(),
      z
        .unknown()
        .transform((value) => JSON.stringify(value))
        .pipe(z.string()),
    ])
    .transform((text) =>
      text.length > PREVIEW_MAX_CELL_CHARS
        ? `${text.slice(0, PREVIEW_MAX_CELL_CHARS)}…`
        : text,
    ),
])

const rawRowSchema = z.record(z.string(), z.unknown())

// Validate row shape without Zod's record copy dropping an own __proto__ column.
const previewRowSchema = z.custom<z.infer<typeof rawRowSchema>>(
  (row) => rawRowSchema.safeParse(row).success,
)

const resultPreviewSchema = z
  .array(previewRowSchema)
  .transform((rows): ResultPreview => {
    const allColumns = rows[0] ? Object.keys(rows[0]) : []
    const columns = allColumns.slice(0, PREVIEW_MAX_COLUMNS)
    const shown = rows.slice(0, PREVIEW_MAX_ROWS)

    return {
      columns,
      rows: shown.map((row) =>
        columns.map((column) => previewCellSchema.parse(row[column])),
      ),
      rowCount: rows.length,
      truncated:
        rows.length > PREVIEW_MAX_ROWS ||
        allColumns.length > PREVIEW_MAX_COLUMNS,
    }
  })

export const buildResultPreview =
  resultPreviewSchema.parse.bind(resultPreviewSchema)

const storedPreviewSchema = z
  .object({
    columns: z.array(z.string()),
    rows: z.array(
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.nan(),
          z.literal(Infinity),
          z.literal(-Infinity),
          z.boolean(),
          z.null(),
        ]),
      ),
    ),
    rowCount: z
      .union([z.number(), z.nan(), z.literal(Infinity), z.literal(-Infinity)])
      .optional()
      .catch(undefined),
    truncated: z.boolean().catch(false),
  })
  .transform((preview): ResultPreview => ({
    ...preview,
    rowCount: preview.rowCount ?? preview.rows.length,
  }))

/** The preview a run stored, or null for older runs and shapes we don't know. */
const storedResultPreviewSchema = z
  .unknown()
  .transform((result): ResultPreview | null => {
    const parsed = z
      .object({ resultPreview: storedPreviewSchema })
      .safeParse(result)

    return parsed.success ? parsed.data.resultPreview : null
  })

export const readResultPreview = storedResultPreviewSchema.parse.bind(
  storedResultPreviewSchema,
)
