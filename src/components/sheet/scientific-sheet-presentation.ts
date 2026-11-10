import { z } from 'zod'
import { fieldEditorPresentation } from '#/lib/field-presentation'
import { pipelineJsonObjectSchema } from '#/lib/pipelines/types'
import type { ScientificColumnWire } from '#/lib/scientific-sheet-data'
import type {
  ScientificWorkbook,
  WorkbookCellAddress,
  WorkbookResult,
} from '#/lib/scientific-workbook'
import type { SheetbaseGridColumn } from './sheetbase-grid'

type ColumnWidths = Partial<Record<string, number>>

const columnWidthsSchema = pipelineJsonObjectSchema
  .refine((value) =>
    Object.values(value).every(
      (width) => z.number().positive().safeParse(width).success,
    ),
  )
  .transform((value) =>
    Object.fromEntries(
      Object.entries(value).map(([id, width]) => [id, z.number().parse(width)]),
    ),
  )

const columnOrderSchema = z.array(z.string())

function readPreference<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  if (typeof window === 'undefined') return fallback

  try {
    const parsed = schema.safeParse(
      JSON.parse(window.localStorage.getItem(key) ?? 'null'),
    )

    return parsed.success ? parsed.data : fallback
  } catch {
    return fallback
  }
}

export function readColumnWidths(key: string): ColumnWidths {
  return readPreference(key, columnWidthsSchema, {})
}

export function readColumnOrder(key: string) {
  return readPreference(key, columnOrderSchema, [])
}

export function writeColumnPreferences(
  key: string,
  value: ColumnWidths | string[],
): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable in private browsing or a locked-down iframe.
  }
}

const FORMULA_ERROR_DISPLAY = new Map([
  ['DIV_BY_ZERO', '#DIV/0!'],
  ['VALUE', '#VALUE!'],
  ['NAME', '#NAME?'],
  ['REF', '#REF!'],
  ['NUM', '#NUM!'],
  ['NA', '#N/A'],
  ['ERROR', '#ERROR!'],
  ['CYCLE', '#CYCLE!'],
  ['SPILL', '#SPILL!'],
  ['LIC', '#LIC!'],
])

export function formulaErrorDisplay(code: string): string {
  return FORMULA_ERROR_DISPLAY.get(code) ?? '#ERROR!'
}

export function displayResult(result: WorkbookResult | null) {
  if (!result) return null

  if (result.status === 'error') return formulaErrorDisplay(result.error)

  return result.logical.ok ? result.logical.value : `#${result.logical.code}!`
}

/** A workbook can briefly predate the stable row/column identity during rebuild. */
export function safeWorkbookGet(
  workbook: ScientificWorkbook,
  address: WorkbookCellAddress,
): WorkbookResult | null {
  try {
    return workbook.get(address)
  } catch {
    return null
  }
}

/** The wrapper, not scientific-sheet callers, owns vendor column mechanics. */
export function sheetbaseColumn(
  column: ScientificColumnWire,
  readOnly: boolean,
): SheetbaseGridColumn {
  const unitSuffix =
    column.unit?.symbol !== undefined ? ` (${column.unit.symbol})` : ''

  const presentation = fieldEditorPresentation(column.logical_type)

  const base: Omit<SheetbaseGridColumn, 'type'> = {
    id: column.id,
    label: `${column.label}${unitSuffix}`,
    source: 'bound',
    readOnly,
  }

  if (presentation.kind === 'number')
    return {
      ...base,
      type: 'number',
      numberFormat:
        column.format ?? (column.logical_type === 'decimal' ? '0.00' : '0'),
      formula: !readOnly,
    }

  if (presentation.kind === 'checkbox') return { ...base, type: 'checkbox' }

  if (presentation.kind === 'date')
    return { ...base, type: 'date', dateFormat: 'YYYY-MM-DD' }

  if (presentation.kind === 'category-select')
    return {
      ...base,
      type: 'select',
      options: column.options.map((option) => option.label),
    }

  return { ...base, type: 'text', formula: !readOnly }
}
