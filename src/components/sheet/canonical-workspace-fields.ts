import { t } from '#/copy'
import type { FieldDefinition } from '#/lib/field-definition'
import type { CanonicalSheetGridColumn } from '#/lib/canonical-sheet-grid'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import { z } from 'zod'
import { formatRecordReferenceLabel } from '#/lib/record-reference-cell'
import type {
  SheetbaseGridCellValue,
  SheetbaseGridColumn,
} from './sheetbase-grid'
import { categoryCellDisplayText } from '#/lib/canonical-sheet-grid'
import { selectableFieldOptions } from '#/lib/field-presentation'
import { formatMagnitude } from '#/lib/format-numbers'
import type { SheetPromoteLocalField } from './sheet-promote'

/** Known labels are display-only; stored identity remains the Record UUID. */
export function recordCellDisplayText(
  labels: Record<string, { identifier: string; title: string } | undefined>,
  value: SheetbaseGridCellValue,
): string {
  const recordId = z.string().safeParse(value)

  if (!recordId.success) return ''
  const snapshot = labels[recordId.data]

  return snapshot ? formatRecordReferenceLabel(snapshot) : recordId.data
}

/** Project canonical field presentation into the neutral grid editor contract. */
export function canonicalWorkspaceGridColumn(
  column: CanonicalSheetGridColumn,
  canWrite: boolean,
  labels: () => Record<
    string,
    { identifier: string; title: string } | undefined
  >,
  /**
   * The Details view: header bands name each column's owner and every header
   * carries its source badge. The everyday view leaves both off. A
   * quantity's unit follows each value in both views; headers carry the
   * name only.
   */
  details = true,
): SheetbaseGridColumn {
  const kind = column.presentation.kind
  const unit = column.field?.quantity?.storageUnit

  const base: Omit<SheetbaseGridColumn, 'type'> = {
    id: column.id,
    label: column.label,
    source: column.origin === 'calculation' ? 'calculated' : column.origin,
    readOnly: !canWrite || !column.editable,
    group: details ? ownerBand(column) : undefined,
    sourceLabel: details ? column.sourceLabel : undefined,
    showSource: details || column.origin === 'calculation',
  }

  if (kind === 'checkbox') return { ...base, type: 'checkbox' }

  if (kind === 'number')
    return {
      ...base,
      type: 'number',
      displayText: unit ? (value) => withUnit(value, unit) : formatMagnitude,
    }

  if (kind === 'date') return { ...base, type: 'date' }

  if (kind === 'datetime-local') return { ...base, type: 'datetime' }

  if (kind === 'record-picker' && canWrite) {
    return {
      ...base,
      type: 'record',
      displayText: (value) => recordCellDisplayText(labels(), value),
    }
  }

  if (kind === 'category-select' && column.field) {
    const options = selectableFieldOptions(column.field, null).map(
      (option) => option.label,
    )

    if (options.length > 0) {
      return {
        ...base,
        type: 'select',
        options,
        displayText: (value) => categoryCellDisplayText(column.field, value),
      }
    }
  }

  return { ...base, type: 'text' }
}

/** The Details view's header band: who owns the columns and what an edit makes. */
function ownerBand(column: CanonicalSheetGridColumn): string {
  if (column.origin === 'calculation')
    return t('notebook.sheetEditLine.bandDerived', { group: column.group })

  if (column.origin === 'local')
    return t('notebook.sheetEditLine.bandLocal', { group: column.group })

  return t('notebook.sheetEditLine.bandBound', {
    group: column.sourceLabel ?? column.group,
  })
}

/** A number with its unit after it; an empty or non-numeric cell is left to the grid. */
function withUnit(
  value: SheetbaseGridCellValue,
  unit: string,
): string | undefined {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- A grid cell value is a closed union; typeof picks its member.
  if (typeof value !== 'number' && typeof value !== 'string') return undefined

  if (value === '') return undefined

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- A grid cell value is a closed union; typeof picks its member.
  const numeric = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numeric)) return undefined
  const text = formatMagnitude(numeric) ?? String(numeric)

  return `${text} ${unit}`
}

/** A reference picker is scoped to the field's own relationship target. */
export function recordPickerTargetModelKey(
  field: FieldDefinition | null,
): string | null {
  const target = field?.relationship?.target

  return target?.kind === 'model' ? target.modelKey : null
}

/** Only active local fields belong to the Sheet and can be promoted. */
export function promotableLocalField(
  instance: SheetInstance,
  column: CanonicalSheetGridColumn | undefined,
): SheetPromoteLocalField | null {
  if (!column || column.origin !== 'local' || !column.field) return null

  const field = instance.state.localFields.find(
    (item) => item.fieldId === column.id && item.lifecycle === 'active',
  )

  if (!field) return null

  const quantity: SheetPromoteLocalField['quantity'] = field.quantity
    ? { storageUnit: field.quantity.storageUnit }
    : null

  if (quantity && field.quantity?.preferredDisplayUnit !== undefined) {
    quantity.preferredDisplayUnit = field.quantity.preferredDisplayUnit
  }

  return {
    fieldId: field.fieldId,
    key: field.key,
    label: field.label,
    logicalType: field.logicalType,
    quantity,
  }
}
