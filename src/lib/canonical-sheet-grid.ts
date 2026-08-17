import { composedSheetGridMatrix } from './composed-sheet-grid'
import type { ComposedSheetGridColumn } from './composed-sheet-grid'
import type { ComposedSheetSnapshot } from './sheet-composition-data'
import { fieldEditorPresentation } from './field-presentation'
import type { FieldEditorPresentation } from './field-presentation'
import type { FieldDefinition } from './field-definition'
import { sheetLocalValueError } from './sheet-local-data'
import type { SheetInstance } from './sheet-instance-data'

export type CanonicalSheetColumnOrigin = 'bound' | 'local' | 'calculation'

export interface CanonicalSheetGridColumn {
  id: string
  label: string
  origin: CanonicalSheetColumnOrigin
  field: FieldDefinition | null
  presentation: FieldEditorPresentation
  editable: boolean
}

export interface CanonicalSheetGridMatrix {
  columns: CanonicalSheetGridColumn[]
  rowKeys: string[]
  rowKinds: Array<'local' | 'composed'>
  data: unknown[][]
}

function activeLocalFields(instance: SheetInstance) {
  return instance.state.localFields.filter(
    (field) => field.lifecycle === 'active',
  )
}

function localColumn(field: FieldDefinition): CanonicalSheetGridColumn {
  return {
    id: field.fieldId,
    label: field.label,
    origin: field.computation.mode === 'computed' ? 'calculation' : 'local',
    field,
    presentation: fieldEditorPresentation(field.logicalType, {
      relationshipTarget: field.relationship?.target.kind ?? null,
    }),
    editable: field.computation.mode !== 'computed',
  }
}

function boundColumn(
  column: ComposedSheetGridColumn,
  snapshot: ComposedSheetSnapshot,
): CanonicalSheetGridColumn {
  const definitionColumn = snapshot.definitionConfiguration?.columns.find(
    (item) => item.id === column.id,
  )
  return {
    id: column.id,
    label: column.label,
    origin: 'bound',
    field: definitionColumn?.field ?? null,
    presentation: column.presentation,
    editable: column.editable,
  }
}

export function parseSheetCellInput(
  field: FieldDefinition | null,
  raw: unknown,
): unknown {
  if (raw === '' || raw === undefined) return null
  if (!field) return raw
  if (field.logicalType === 'boolean') {
    if (typeof raw === 'boolean') return raw
    if (raw === 'true' || raw === 'TRUE' || raw === 1 || raw === '1')
      return true
    if (raw === 'false' || raw === 'FALSE' || raw === 0 || raw === '0')
      return false
    return raw
  }
  if (field.logicalType === 'integer') {
    if (typeof raw === 'number' && Number.isSafeInteger(raw)) return raw
    if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim()))
      return Number(raw.trim())
    return raw
  }
  if (field.logicalType === 'decimal') {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    if (
      typeof raw === 'string' &&
      raw.trim() !== '' &&
      !Number.isNaN(Number(raw))
    )
      return Number(raw)
    return raw
  }
  return raw
}

export function canonicalSheetGridMatrix(input: {
  instance: SheetInstance
  composition: ComposedSheetSnapshot | null
  calculationResults?: Record<string, Record<string, unknown>>
}): CanonicalSheetGridMatrix {
  const localFields = activeLocalFields(input.instance)
  const calculations = input.instance.state.instanceCalculations ?? []
  const calculationColumns = calculations
    .filter((item) => item.lifecycle === 'active')
    .map((item) => localColumn(item.outputField))

  if (input.composition) {
    const composed = composedSheetGridMatrix(input.composition)
    const bound = composed.columns.map((column) =>
      boundColumn(column, input.composition!),
    )
    const boundIds = new Set(bound.map((column) => column.id))
    const extraLocal = localFields
      .filter((field) => !boundIds.has(field.fieldId))
      .map(localColumn)
    const extraCalc = calculationColumns.filter(
      (column) => !boundIds.has(column.id),
    )
    const columns = [...bound, ...extraLocal, ...extraCalc]
    const composedKeys = new Set(composed.rowKeys)
    const unmatchedLocal = Object.keys(input.instance.state.localValues).filter(
      (rowKey) => !composedKeys.has(rowKey),
    )
    const rowKeys = [...composed.rowKeys, ...unmatchedLocal]
    const boundIndex = new Map(
      composed.columns.map((column, index) => [column.id, index]),
    )
    const data = rowKeys.map((rowKey, index) => {
      const composedRow =
        index < composed.rowKeys.length ? composed.data[index] : null
      return columns.map((column) => {
        if (column.origin === 'bound' && composedRow) {
          const sourceIndex = boundIndex.get(column.id)
          return sourceIndex === undefined
            ? null
            : (composedRow[sourceIndex] ?? null)
        }
        if (column.origin === 'calculation') {
          return (
            input.calculationResults?.[rowKey]?.[column.id] ??
            input.instance.state.localValues[rowKey][column.id] ??
            null
          )
        }
        return input.instance.state.localValues[rowKey][column.id] ?? null
      })
    })
    return {
      columns,
      rowKeys,
      rowKinds: rowKeys.map((rowKey) =>
        composedKeys.has(rowKey) ? 'composed' : 'local',
      ),
      data,
    }
  }

  const columns = [...localFields.map(localColumn), ...calculationColumns]
  const rowKeys = Object.keys(input.instance.state.localValues)
  return {
    columns,
    rowKeys,
    rowKinds: rowKeys.map(() => 'local'),
    data: rowKeys.map((rowKey) =>
      columns.map((column) => {
        if (column.origin === 'calculation') {
          return (
            input.calculationResults?.[rowKey]?.[column.id] ??
            input.instance.state.localValues[rowKey][column.id] ??
            null
          )
        }
        return input.instance.state.localValues[rowKey][column.id] ?? null
      }),
    ),
  }
}

export function validateCanonicalCell(
  field: FieldDefinition | null,
  value: unknown,
): string | null {
  if (!field) return null
  return sheetLocalValueError(field, value)
}
