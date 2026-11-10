import { z } from 'zod'

import type {
  SheetbaseGridCellValue,
  SheetbaseGridJsonValue,
} from './sheetbase-grid'

/** Decode only where a host API/engine erases the scientific value contract. */
export const sheetbaseGridCellValueSchema: z.ZodType<SheetbaseGridCellValue> =
  z.union([z.json(), z.date()])

function isGridArray(
  value: SheetbaseGridCellValue,
): value is readonly SheetbaseGridJsonValue[] {
  return Array.isArray(value)
}

/** Preserve the engine adapter's legacy display coercion, not JSON encoding. */
export function gridStoredText(
  value: SheetbaseGridCellValue | undefined,
): string {
  if (value == null) return ''

  if (value instanceof Date) return value.toString()

  // Array#toString joins recursively; null elements contribute blank text.
  if (isGridArray(value)) return value.map(gridStoredText).join(',')

  if (value instanceof Object) return '[object Object]'

  return String(value)
}
