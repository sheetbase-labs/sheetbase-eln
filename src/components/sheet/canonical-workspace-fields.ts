import type { FieldDefinition } from '#/lib/field-definition'
import type { CanonicalSheetGridColumn } from '#/lib/canonical-sheet-grid'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import { z } from 'zod'
import { formatRecordReferenceLabel } from '#/lib/record-reference-cell'
import type {
  SheetbaseGridCellValue,
  SheetbaseGridColumn,
} from './sheetbase-grid'
import {
  canonicalSheetColumnHeader,
  categoryCellDisplayText,
} from '#/lib/canonical-sheet-grid'
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
): SheetbaseGridColumn {
  const kind = column.presentation.kind

  const base: Omit<SheetbaseGridColumn, 'type'> = {
    id: column.id,
    label: canonicalSheetColumnHeader(column),
    source: column.origin === 'calculation' ? 'calculated' : column.origin,
    readOnly: !canWrite || !column.editable,
    group: column.group,
    sourceLabel: column.sourceLabel,
  }

  if (kind === 'checkbox') return { ...base, type: 'checkbox' }

  if (kind === 'number')
    return { ...base, type: 'number', displayText: formatMagnitude }

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
