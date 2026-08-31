import { composedSheetGridMatrix } from './composed-sheet-grid'
import type { ComposedSheetGridColumn } from './composed-sheet-grid'
import type { ComposedSheetSnapshot } from './sheet-composition-data'
import { fieldEditorPresentation } from './field-presentation'
import type { FieldEditorPresentation } from './field-presentation'
import type { FieldDefinition, FieldOption } from './field-definition'
import { sheetLocalValueError } from './sheet-local-data'
import type { SheetInstance } from './sheet-instance-data'
import type { SheetPresentation } from './sheet-instance'

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

/** GRID-03 — editor/paste input for a timestamp field. The grid has no
 * timezone context and canonical storage is a UTC instant, so a bare
 * calendar-plus-time input (with or without seconds, space separator) is
 * interpreted as UTC. Values outside this shape pass through untouched and
 * fail closed at validation. */
const timestampInput =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/

function canonicalTimestampInput(raw: string): string | null {
  const match = timestampInput.exec(raw)
  if (!match) return null
  const [, date, time, seconds = '00', fraction = ''] = match
  const offset = match.at(5) ?? 'Z'
  return `${date}T${time}:${seconds}${fraction}${offset}`
}

/** GRID-03 — resolve a typed/pasted category value to the canonical option id.
 * An exact id is kept; an active option's stable key or display label maps to
 * its id. Retired options and unknown text stay untouched and fail closed at
 * validation — the server remains the vocabulary authority. */
function canonicalCategoryOption(
  field: FieldDefinition,
  raw: string,
): FieldOption | undefined {
  if (field.category?.kind !== 'embedded') return undefined
  const options = field.category.options
  return (
    options.find((option) => option.id === raw) ??
    options.find(
      (option) => option.key === raw && option.lifecycle === 'active',
    ) ??
    options.find(
      (option) => option.label === raw && option.lifecycle === 'active',
    )
  )
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
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
      // GRID-03: thousands-separated clipboard values coerce when the
      // grouping is unambiguous; anything else fails closed.
      if (/^-?\d{1,3}(,\d{3})+$/.test(trimmed))
        return Number(trimmed.replace(/,/g, ''))
    }
    return raw
  }
  if (field.logicalType === 'decimal') {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed !== '' && !Number.isNaN(Number(trimmed)))
        return Number(trimmed)
      if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed))
        return Number(trimmed.replace(/,/g, ''))
    }
    return raw
  }
  if (field.logicalType === 'timestamp' && typeof raw === 'string') {
    const coerced = canonicalTimestampInput(raw)
    if (coerced) return coerced
    return raw
  }
  if (field.logicalType === 'category' && typeof raw === 'string') {
    const option = canonicalCategoryOption(field, raw)
    if (option) return option.id
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

/**
 * GRID-04 — project the canonical matrix through the presentation working
 * state: columns are reordered per `columnOrder` and hidden columns removed.
 * This is display-only resequencing — the underlying canonical column order
 * (definition/configuration or local field order) is untouched, row identity
 * is unaffected and no data value changes. Unknown, duplicate or hidden
 * `columnOrder` entries are ignored; canonical columns missing from the saved
 * order keep their canonical position at the end, mirroring the frozen-sheet
 * evidence reconstruction.
 */
export function applySheetPresentation(
  matrix: CanonicalSheetGridMatrix,
  presentation: SheetPresentation,
): CanonicalSheetGridMatrix {
  const byId = new Map(matrix.columns.map((column) => [column.id, column]))
  const hidden = new Set(
    presentation.hiddenColumnIds.filter((id) => byId.has(id)),
  )
  const ordered: CanonicalSheetGridColumn[] = []
  const seen = new Set<string>()
  for (const id of presentation.columnOrder) {
    if (hidden.has(id) || seen.has(id)) continue
    const column = byId.get(id)
    if (!column) continue
    seen.add(id)
    ordered.push(column)
  }
  for (const column of matrix.columns) {
    if (hidden.has(column.id) || seen.has(column.id)) continue
    seen.add(column.id)
    ordered.push(column)
  }
  const sourceIndex = new Map(
    matrix.columns.map((column, index) => [column.id, index]),
  )
  const data = matrix.data.map((row) =>
    ordered.map((column) => row[sourceIndex.get(column.id) as number]),
  )
  return {
    columns: ordered,
    rowKeys: matrix.rowKeys,
    rowKinds: matrix.rowKinds,
    data,
  }
}

/**
 * GRID-02/GRID-03 — resolve a change set (paste, fill, clear, single edit)
 * against the typed column contract before Handsontable applies anything.
 * Every value is coerced through `parseSheetCellInput` (canonical category
 * option, UTC instant, thousands-separated number) and validated. A bulk or
 * single write is accepted only when every target cell is editable and every
 * value parses and validates; otherwise the whole operation fails closed, so
 * the visible grid can never diverge from the authoritative state. The
 * returned change list carries the coerced canonical values for the caller to
 * apply back onto Handsontable's change array.
 */
export type BulkChangeRejection =
  | { kind: 'read_only_column'; label: string }
  | { kind: 'invalid_value'; label: string; detail: string }

export interface CanonicalCellChangeResult {
  changes: Array<[number, string | number, unknown, unknown]>
  rejection: BulkChangeRejection | null
}

export function resolveCanonicalCellChanges(
  columns: CanonicalSheetGridColumn[],
  changes: Array<[number, string | number, unknown, unknown]>,
): CanonicalCellChangeResult {
  const resolved: Array<[number, string | number, unknown, unknown]> = []
  for (const change of changes) {
    const columnIndex =
      typeof change[1] === 'number' ? change[1] : Number(change[1])
    const column = columns.at(columnIndex)
    // Columns outside the canonical matrix (row headers etc.) are not writes.
    if (!column) {
      resolved.push([change[0], change[1], change[2], change[3]])
      continue
    }
    if (!column.editable) {
      return {
        changes: resolved,
        rejection: { kind: 'read_only_column', label: column.label },
      }
    }
    const value = parseSheetCellInput(column.field, change[3])
    const invalid = validateCanonicalCell(column.field, value)
    if (invalid) {
      return {
        changes: resolved,
        rejection: {
          kind: 'invalid_value',
          label: column.label,
          detail: invalid,
        },
      }
    }
    resolved.push([change[0], change[1], change[2], value])
  }
  return { changes: resolved, rejection: null }
}

export function firstBulkChangeRejection(
  columns: CanonicalSheetGridColumn[],
  changes: Array<[number, string | number, unknown, unknown]>,
): BulkChangeRejection | null {
  return resolveCanonicalCellChanges(columns, changes).rejection
}

/**
 * GRID-02 — compute the change list for a "clear contents" bulk operation.
 *
 * Returns `[row, col, null]` triples for every editable, non-empty cell in
 * the selection (Handsontable's `setDataAtCell` change format reads element
 * `[2]` as the new value). Read-only/derived columns and already-empty cells
 * are skipped, so clearing never mints phantom spare-row entries and the
 * workspace `beforeChange` validation remains the fail-closed gate for
 * required fields. Column resolution mirrors GRID-02's `toPhysicalRow` row
 * mapping via `toPhysicalColumn`; returned coordinates stay visual so
 * `setDataAtCell` applies them unchanged.
 */
export function clearContentsUpdates(
  columns: CanonicalSheetGridColumn[],
  ranges: Array<{
    from: { row: number | null; col: number | null }
    to: { row: number | null; col: number | null }
  }>,
  readCell: (row: number, col: number) => unknown,
  toPhysicalColumn: (visualColumn: number) => number = (col) => col,
): Array<[number, number, unknown]> {
  const updates: Array<[number, number, unknown]> = []
  for (const range of ranges) {
    const fromRow = range.from.row ?? 0
    const toRow = range.to.row ?? 0
    const fromCol = range.from.col ?? 0
    const toCol = range.to.col ?? 0
    const startRow = Math.max(0, Math.min(fromRow, toRow))
    const endRow = Math.max(fromRow, toRow)
    const startCol = Math.max(0, Math.min(fromCol, toCol))
    const endCol = Math.max(fromCol, toCol)
    for (let row = startRow; row <= endRow; row += 1) {
      for (let col = startCol; col <= endCol; col += 1) {
        const column = columns.at(toPhysicalColumn(col))
        if (!column || !column.editable) continue
        const current = readCell(row, col)
        if (current == null || current === '') continue
        updates.push([row, col, null])
      }
    }
  }
  return updates
}

/**
 * GRID-03 — display-only column header for the grid. Quantity fields show
 * their canonical storage unit next to the label so scientists can see which
 * unit typed values are stored in; units are never converted client-side.
 */
export function canonicalSheetColumnHeader(
  column: CanonicalSheetGridColumn,
): string {
  const unit = column.field?.quantity?.storageUnit
  return unit ? `${column.label} (${unit})` : column.label
}

/**
 * GRID-03 — display-only text for a category cell. The canonical stored value
 * is the option id; known options render as their label, unknown or
 * vocabulary-backed values render as-is. This never changes stored state.
 */
export function categoryCellDisplayText(
  field: FieldDefinition | null,
  value: unknown,
): string {
  if (value == null) return ''
  if (field?.category?.kind === 'embedded') {
    const option =
      field.category.options.find((item) => item.id === value) ??
      field.category.options.find((item) => item.key === value)
    if (option) return option.label
  }
  return String(value)
}

/**
 * GRID-04 — typed mapping between Handsontable 18's Filters plugin state and
 * `presentation.filters`.
 *
 * The plugin's condition collection is deterministic and serialisable:
 * `afterFilter` hands over `{ column, conditions, operation }` stacks keyed by
 * the grid's physical column index (`Filters#exportConditions`), and
 * `addCondition(…)` + `filter()` rebuild them. The canonical presentation
 * schema accepts only four equality operators on stable column ids, so only
 * plugin conditions with an exact typed counterpart round-trip; everything
 * else (by-value checkbox lists, contains/date predicates, OR groups) stays
 * session-visual and is honestly omitted from the saved view.
 */
export interface HotFilterConditionStack {
  /** Physical column index into the grid data (== index into `columns`). */
  column: number
  conditions: Array<{ name: string; args?: unknown[] }>
  operation?: string
}

/** One `addCondition` call for the Filters plugin, visual column indexes. */
export interface HotFilterAddition {
  column: number
  name: 'eq' | 'neq' | 'empty' | 'not_empty' | 'true' | 'false'
  args: unknown[]
}

const CAPTURED_FILTER_CAP = 32

function isFilterValue(
  value: unknown,
): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

/**
 * GRID-04 — convert a Handsontable `afterFilter` conditions stack into
 * canonical `presentation.filters`. Column coordinates resolve through the
 * composed matrix's physical column order; only equality-shaped conditions
 * under a plain AND group are captured (the `true`/`false` checkbox conditions
 * map to `equals` with a boolean value). Anything the schema cannot express is
 * dropped, capped at the schema's 32-entry limit.
 */
export function hotFiltersToPresentationFilters(
  conditionsStack: readonly HotFilterConditionStack[],
  columns: ReadonlyArray<{ id: string }>,
): SheetPresentation['filters'] {
  const filters: SheetPresentation['filters'] = []
  for (const entry of conditionsStack) {
    // The schema has no per-column OR: a disjunction group cannot be restored
    // faithfully, so the whole group stays session-visual.
    if (entry.operation !== undefined && entry.operation !== 'conjunction')
      continue
    if (
      !Number.isInteger(entry.column) ||
      entry.column < 0 ||
      entry.column >= columns.length
    )
      continue
    const columnId = columns[entry.column]?.id
    if (!columnId) continue
    for (const condition of entry.conditions) {
      if (filters.length >= CAPTURED_FILTER_CAP) return filters
      const name = condition.name
      if (name === 'true') {
        filters.push({ columnId, operator: 'equals', value: true })
        continue
      }
      if (name === 'false') {
        filters.push({ columnId, operator: 'equals', value: false })
        continue
      }
      if (name === 'empty') {
        filters.push({ columnId, operator: 'is-empty' })
        continue
      }
      if (name === 'not_empty') {
        filters.push({ columnId, operator: 'is-not-empty' })
        continue
      }
      if (name === 'eq' || name === 'neq') {
        const value = condition.args?.at(0)
        if (!isFilterValue(value)) continue
        filters.push({
          columnId,
          operator: name === 'eq' ? 'equals' : 'not-equals',
          value,
        })
      }
      // Any other condition name has no canonical counterpart — omit it.
    }
  }
  return filters
}

/**
 * GRID-04 — convert canonical `presentation.filters` into `addCondition`
 * calls for the Filters plugin. Columns resolve through the display matrix;
 * a filter on a hidden or retired column has no visual index and is skipped.
 */
export function presentationFiltersToHotAdditions(
  filters: SheetPresentation['filters'],
  columns: ReadonlyArray<{ id: string }>,
): HotFilterAddition[] {
  const additions: HotFilterAddition[] = []
  const visualByColumnId = new Map(
    columns.map((column, index) => [column.id, index]),
  )
  for (const filter of filters) {
    const column = visualByColumnId.get(filter.columnId)
    if (column === undefined) continue
    if (filter.operator === 'equals') {
      if (filter.value === true) {
        additions.push({ column, name: 'true', args: [] })
      } else if (filter.value === false) {
        additions.push({ column, name: 'false', args: [] })
      } else {
        additions.push({ column, name: 'eq', args: [filter.value ?? null] })
      }
    } else if (filter.operator === 'not-equals') {
      additions.push({ column, name: 'neq', args: [filter.value ?? null] })
    } else if (filter.operator === 'is-empty') {
      additions.push({ column, name: 'empty', args: [] })
    } else {
      additions.push({ column, name: 'not_empty', args: [] })
    }
  }
  return additions
}
