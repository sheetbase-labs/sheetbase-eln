/**
 * What Bench entry and the grid need to know about one field: why it can't be
 * typed into, the range it states, and whether a value falls outside it.
 */
import { t } from '#/copy'
import type { CanonicalSheetGridColumn } from '#/lib/canonical-sheet-grid'
import type { SheetbaseGridCellValue } from './sheetbase-grid'

/** Why a field can't be typed into here, in a scientist's words. */
export function benchReadOnlyReason(
  column: CanonicalSheetGridColumn,
  canWrite: boolean,
): string | null {
  if (column.origin === 'calculation')
    return t('notebook.sheetBench.calculated')

  if (!canWrite) return t('notebook.sheetBench.viewOnly')

  if (column.presentation.kind === 'record-picker')
    return t('notebook.sheetBench.linkedRecord')

  if (!column.editable) return t('notebook.sheetBench.fromDataset')

  return null
}

/** The allowed range a field states, as text, or null when it states none. */
export function benchRange(column: CanonicalSheetGridColumn): string | null {
  const validation = column.field?.validation
  const unit = column.field?.quantity?.storageUnit
  const min = validation?.min
  const max = validation?.max

  if (min === undefined && max === undefined) return null

  const suffix = unit ? ` ${unit}` : ''

  if (min !== undefined && max !== undefined)
    return t('notebook.sheetBench.rangeBetween', {
      min,
      max,
      unit: suffix,
    })

  return min !== undefined
    ? t('notebook.sheetBench.rangeAtLeast', { min, unit: suffix })
    : t('notebook.sheetBench.rangeAtMost', { max: max ?? '', unit: suffix })
}

/** A typed value outside the field's range, explained; null when it fits. */
export function benchRangeBreach(
  column: Pick<CanonicalSheetGridColumn, 'field'>,
  text: string,
): string | null {
  const { min, max } = column.field?.validation ?? {}

  if ((min === undefined && max === undefined) || text.trim() === '')
    return null

  const value = Number(text)

  if (!Number.isFinite(value)) return null

  const storageUnit = column.field?.quantity?.storageUnit
  const unit = storageUnit ? ` ${storageUnit}` : ''
  const below = min !== undefined && value < min
  const above = max !== undefined && value > max

  if (!below && !above) return null

  if (min !== undefined && max !== undefined)
    return t(
      above
        ? 'notebook.sheetBench.aboveRange'
        : 'notebook.sheetBench.belowRange',
      { min, max, unit },
    )

  if (max !== undefined && above)
    return t('notebook.sheetBench.aboveMax', { max, unit })

  return t('notebook.sheetBench.belowMin', { min: String(min), unit })
}

/** A stored value outside its field's range: the grid shows it in danger text. */
export function outOfRange(
  column: CanonicalSheetGridColumn | undefined,
  value: SheetbaseGridCellValue | undefined,
): boolean {
  if (!column) return false

  return benchRangeBreach(column, benchInputText(value)) !== null
}

export function benchInputText(
  value: SheetbaseGridCellValue | undefined,
): string {
  if (value === null || value === undefined) return ''

  if (value instanceof Date) return value.toISOString()

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- A grid cell value is a closed union; typeof picks its member.
  if (typeof value === 'number') {
    const size = Math.abs(value)

    // Very large or small magnitudes read as e-notation, which Number() takes back.
    return size !== 0 && (size >= 1e7 || size < 1e-4)
      ? value.toExponential().replace('e+', 'e')
      : String(value)
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- A grid cell value is a closed union; typeof picks its member.
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}
