import { describe, expect, it } from 'vitest'

import {
  applySheetPresentation,
  canonicalSheetColumnHeader,
  canonicalSheetGridMatrix,
  categoryCellDisplayText,
  clearContentsUpdates,
  firstBulkChangeRejection,
  hotFiltersToPresentationFilters,
  parseSheetCellInput,
  presentationFiltersToHotAdditions,
  resolveCanonicalCellChanges,
  validateCanonicalCell,
} from './canonical-sheet-grid'
import type {
  CanonicalSheetGridColumn,
  HotFilterConditionStack,
} from './canonical-sheet-grid'
import type { FieldDefinition } from './field-definition'
import type { ComposedSheetSnapshot } from './sheet-composition-data'
import { validSheetInstanceState } from './sheet-instance.test'
import { sanitizeSheetPresentation } from './sheet-presentation-view'

const fieldId = '10000000-0000-4000-8000-000000000004'
const rowId = '10000000-0000-4000-8000-000000000005'

function instance() {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    workspaceId: '20000000-0000-4000-8000-000000000002',
    projectId: '20000000-0000-4000-8000-000000000003',
    notebookRecordId: '20000000-0000-4000-8000-000000000006',
    sourceDefinitionVersionId: null,
    name: 'Notebook sheet',
    description: null,
    lifecycle: 'active' as const,
    revision: 1,
    state: validSheetInstanceState(),
    duplicatedFromInstanceId: null,
    createdAt: '2026-08-16T12:00:00.000Z',
    updatedAt: '2026-08-16T12:00:00.000Z',
    createdByUserId: 'u1',
    updatedByUserId: 'u1',
  }
}

describe('canonicalSheetGridMatrix', () => {
  it('places local columns and values on one grid without composition', () => {
    const matrix = canonicalSheetGridMatrix({
      instance: instance(),
      composition: null,
    })
    expect(matrix.columns.map((column) => column.label)).toEqual([
      'Observation',
    ])
    expect(matrix.columns[0]?.origin).toBe('local')
    expect(matrix.rowKeys).toEqual([rowId])
    expect(matrix.data[0]?.[0]).toBe('independent value')
  })

  it('keeps governed editability and local identity on the canonical composed grid', () => {
    const editableBound = '30000000-0000-4000-8000-000000000001'
    const derivedBound = '30000000-0000-4000-8000-000000000002'
    const composedRow = `sb-row-v1:${'a'.repeat(64)}`
    const snapshot = {
      boundProjection: {
        columns: [
          {
            id: editableBound,
            label: 'Governed result',
            presentation: { kind: 'text', inputType: 'text' },
            permission: { editability: 'editable' },
          },
          {
            id: derivedBound,
            label: 'Derived recovery',
            presentation: { kind: 'number', inputType: 'number' },
            permission: { editability: 'read_only' },
          },
        ],
        rows: [
          {
            rowKey: composedRow,
            values: {
              [editableBound]: { kind: 'present', value: 12 },
              [derivedBound]: { kind: 'present', value: 24 },
            },
          },
        ],
      },
    } as unknown as ComposedSheetSnapshot

    const composedInstance = instance()
    composedInstance.state.localValues[composedRow] = {}
    const matrix = canonicalSheetGridMatrix({
      instance: composedInstance,
      composition: snapshot,
    })

    expect(
      matrix.columns.map(({ label, origin, editable }) => ({
        label,
        origin,
        editable,
      })),
    ).toEqual([
      { label: 'Governed result', origin: 'bound', editable: true },
      { label: 'Derived recovery', origin: 'bound', editable: false },
      { label: 'Observation', origin: 'local', editable: true },
    ])
    expect(matrix.rowKeys).toEqual([composedRow, rowId])
    expect(matrix.data).toEqual([
      [12, 24, null],
      [null, null, 'independent value'],
    ])
  })
})

describe('parseSheetCellInput', () => {
  it('coerces numeric and boolean editor values', () => {
    const integer = {
      ...instance().state.localFields[0],
      logicalType: 'integer' as const,
    }
    const flag = {
      ...instance().state.localFields[0],
      logicalType: 'boolean' as const,
    }
    expect(parseSheetCellInput(integer, '12')).toBe(12)
    expect(parseSheetCellInput(flag, 'true')).toBe(true)
    expect(parseSheetCellInput(integer, '')).toBeNull()
  })
})

describe('validateCanonicalCell', () => {
  it('rejects invalid integers for typed local fields', () => {
    const field = instance().state.localFields[0]
    expect(
      validateCanonicalCell({ ...field, logicalType: 'integer' }, 'x'),
    ).toBe('invalid_value')
    expect(validateCanonicalCell(field, 'ok')).toBeNull()
    expect(fieldId).toHaveLength(36)
  })
})

const editableNumeric: CanonicalSheetGridColumn = {
  id: 'col-editable',
  label: 'Titer',
  origin: 'bound',
  field: {
    fieldId: 'field-titer',
    key: 'titer',
    label: 'Titer',
    description: null,
    logicalType: 'decimal',
    nullable: true,
    defaultValue: null,
    cardinality: 'one',
    quantity: null,
    validation: {},
    category: null,
    relationship: null,
    computation: { mode: 'stored' },
    lifecycle: 'active',
  },
  presentation: { kind: 'number', inputType: 'number' },
  editable: true,
}
const readOnly: CanonicalSheetGridColumn = {
  id: 'col-readonly',
  label: 'Recovery',
  origin: 'calculation',
  field: null,
  presentation: { kind: 'text', inputType: null },
  editable: false,
}
const bulkColumns = [editableNumeric, readOnly]

const categoryField: FieldDefinition = {
  ...editableNumeric.field!,
  logicalType: 'category',
  category: {
    kind: 'embedded',
    options: [
      {
        id: '40000000-0000-4000-8000-000000000001',
        key: 'active',
        label: 'Active',
        displayOrder: 0,
        lifecycle: 'active',
      },
      {
        id: '40000000-0000-4000-8000-000000000002',
        key: 'paused',
        label: 'Paused',
        displayOrder: 1,
        lifecycle: 'active',
      },
      {
        id: '40000000-0000-4000-8000-000000000003',
        key: 'retired',
        label: 'Retired label',
        displayOrder: 2,
        lifecycle: 'retired',
      },
    ],
  },
}

describe('typed editing coercion (GRID-03)', () => {
  it('maps category labels, keys and ids to the canonical option id', () => {
    expect(parseSheetCellInput(categoryField, 'Active')).toBe(
      '40000000-0000-4000-8000-000000000001',
    )
    expect(parseSheetCellInput(categoryField, 'paused')).toBe(
      '40000000-0000-4000-8000-000000000002',
    )
    expect(
      parseSheetCellInput(
        categoryField,
        '40000000-0000-4000-8000-000000000001',
      ),
    ).toBe('40000000-0000-4000-8000-000000000001')
    expect(
      validateCanonicalCell(
        categoryField,
        parseSheetCellInput(categoryField, 'Active'),
      ),
    ).toBeNull()
  })

  it('fails closed on retired and unknown category text', () => {
    expect(parseSheetCellInput(categoryField, 'Retired label')).toBe(
      'Retired label',
    )
    expect(
      validateCanonicalCell(
        categoryField,
        parseSheetCellInput(categoryField, 'Retired label'),
      ),
    ).toBe('invalid_value')
    // A retired option's id parses but is not selectable vocabulary.
    expect(
      validateCanonicalCell(
        categoryField,
        parseSheetCellInput(
          categoryField,
          '40000000-0000-4000-8000-000000000003',
        ),
      ),
    ).toBe('invalid_category_option')
    expect(
      validateCanonicalCell(
        categoryField,
        parseSheetCellInput(categoryField, 'Nope'),
      ),
    ).toBe('invalid_value')
  })

  it('coerces bare date-time input to canonical UTC instants', () => {
    const timestamp = {
      ...editableNumeric.field!,
      logicalType: 'timestamp' as const,
    }
    expect(parseSheetCellInput(timestamp, '2026-01-05 14:30')).toBe(
      '2026-01-05T14:30:00Z',
    )
    expect(parseSheetCellInput(timestamp, '2026-01-05T14:30:05.250')).toBe(
      '2026-01-05T14:30:05.250Z',
    )
    expect(parseSheetCellInput(timestamp, '2026-01-05T14:30:05+02:00')).toBe(
      '2026-01-05T14:30:05+02:00',
    )
    expect(parseSheetCellInput(timestamp, '2026-08-15T10:20:30Z')).toBe(
      '2026-08-15T10:20:30Z',
    )
    expect(parseSheetCellInput(timestamp, '2026-01-01 00:00:00')).toBe(
      '2026-01-01T00:00:00Z',
    )
    expect(validateCanonicalCell(timestamp, '2026-13-05T14:30:00Z')).toBe(
      'invalid_value',
    )
  })

  it('coerces thousands-separated clipboard numbers when unambiguous', () => {
    const integer = {
      ...editableNumeric.field!,
      logicalType: 'integer' as const,
    }
    const decimal = editableNumeric.field!
    expect(parseSheetCellInput(decimal, '1,200.5')).toBe(1200.5)
    expect(parseSheetCellInput(integer, '1,200')).toBe(1200)
    expect(parseSheetCellInput(integer, '-12,345')).toBe(-12345)
    // Ambiguous or malformed groupings never coerce; they fail closed.
    expect(parseSheetCellInput(decimal, '12,34')).toBe('12,34')
    expect(validateCanonicalCell(decimal, '12,34')).toBe('invalid_value')
  })
})

describe('bulk change validation (GRID-02)', () => {
  const columns = bulkColumns

  it('accepts a fully editable, type-safe bulk change set', () => {
    expect(
      firstBulkChangeRejection(columns, [
        [0, 0, null, 1.2e9],
        [1, 0, null, '8.5e8'],
      ]),
    ).toBeNull()
  })

  it('rejects the whole bulk write when any target is read-only or derived', () => {
    expect(
      firstBulkChangeRejection(columns, [
        [0, 0, null, 1],
        [0, 1, null, 'nope'],
      ]),
    ).toEqual({ kind: 'read_only_column', label: 'Recovery' })
  })

  it('rejects the whole bulk write on a value that violates the field type', () => {
    expect(
      firstBulkChangeRejection(columns, [[0, 0, null, 'not-a-number']]),
    ).toEqual({
      kind: 'invalid_value',
      label: 'Titer',
      detail: 'invalid_value',
    })
  })

  it('ignores non-matrix columns and treats empty input as null', () => {
    expect(
      firstBulkChangeRejection(columns, [
        [0, 7, null, 'header-cell'],
        [2, 0, null, ''],
      ]),
    ).toBeNull()
  })
})

describe('clear contents updates (GRID-02 review fixes)', () => {
  const columns = bulkColumns

  it('emits [row, col, null] triples — never the old value as the new value', () => {
    const updates = clearContentsUpdates(
      columns,
      [{ from: { row: 0, col: 0 }, to: { row: 1, col: 1 } }],
      (row, col) => (row === 0 && col === 0 ? 1.2e9 : 'filled'),
    )
    // Row 0 col 0 is editable and filled; col 1 is derived (skipped);
    // row 1 col 0 is editable and filled; row 1 col 1 derived (skipped).
    expect(updates).toEqual([
      [0, 0, null],
      [1, 0, null],
    ])
    for (const [, , newValue] of updates) expect(newValue).toBeNull()
  })

  it('skips nullish and empty cells so spare rows mint no phantom rows', () => {
    const updates = clearContentsUpdates(
      columns,
      [{ from: { row: 0, col: 0 }, to: { row: 2, col: 0 } }],
      (row) => (row === 0 ? 5 : row === 1 ? undefined : null),
    )
    expect(updates).toEqual([[0, 0, null]])
  })

  it('returns an empty list for an all-empty selection', () => {
    expect(
      clearContentsUpdates(
        columns,
        [{ from: { row: 0, col: 1 }, to: { row: 0, col: 1 } }],
        () => null,
      ),
    ).toEqual([])
  })
})

describe('resolveCanonicalCellChanges (GRID-03)', () => {
  const categoryColumn: CanonicalSheetGridColumn = {
    ...editableNumeric,
    field: categoryField,
    presentation: { kind: 'category-select', inputType: null },
  }

  it('coerces editor output to canonical values and keeps positions', () => {
    const result = resolveCanonicalCellChanges(bulkColumns, [
      [3, 0, null, '8,000'],
      [4, 0, null, '12'],
    ])
    expect(result.rejection).toBeNull()
    expect(result.changes).toEqual([
      [3, 0, null, 8000],
      [4, 0, null, 12],
    ])
  })

  it('rejects a single typed edit like a bulk write', () => {
    const result = resolveCanonicalCellChanges(bulkColumns, [
      [0, 0, 1.2, 'not-a-number'],
    ])
    expect(result.rejection).toEqual({
      kind: 'invalid_value',
      label: 'Titer',
      detail: 'invalid_value',
    })
  })

  it('keeps the GRID-02 read-only wholesale rejection', () => {
    expect(
      resolveCanonicalCellChanges(bulkColumns, [[0, 1, null, 'x']]).rejection,
    ).toEqual({ kind: 'read_only_column', label: 'Recovery' })
  })

  it('coerces pasted category text to the canonical option id', () => {
    const result = resolveCanonicalCellChanges(
      [categoryColumn],
      [[0, 0, null, 'Paused']],
    )
    expect(result.rejection).toBeNull()
    expect(result.changes[0]?.[3]).toBe('40000000-0000-4000-8000-000000000002')
  })
})

describe('column header and category display (GRID-03)', () => {
  it('surfaces the quantity storage unit in the header, display only', () => {
    expect(canonicalSheetColumnHeader(editableNumeric)).toBe('Titer')
    const quantified: CanonicalSheetGridColumn = {
      ...editableNumeric,
      field: {
        ...editableNumeric.field!,
        quantity: {
          kind: 'titer',
          dimension: 'concentration',
          storageUnit: 'IU/mL',
        },
      },
    }
    expect(canonicalSheetColumnHeader(quantified)).toBe('Titer (IU/mL)')
    expect(canonicalSheetColumnHeader(readOnly)).toBe('Recovery')
  })

  it('renders known category values as labels and unknown values as-is', () => {
    expect(
      categoryCellDisplayText(
        categoryField,
        '40000000-0000-4000-8000-000000000002',
      ),
    ).toBe('Paused')
    expect(categoryCellDisplayText(categoryField, 'paused')).toBe('Paused')
    expect(categoryCellDisplayText(categoryField, 'Retired label')).toBe(
      'Retired label',
    )
    expect(categoryCellDisplayText(categoryField, null)).toBe('')
    expect(categoryCellDisplayText(null, 12)).toBe('12')
  })
})

describe('applySheetPresentation (GRID-04)', () => {
  const third: CanonicalSheetGridColumn = {
    ...readOnly,
    id: 'col-third',
    label: 'Notes',
  }
  const baseMatrix = {
    columns: bulkColumns,
    rowKeys: [rowId],
    rowKinds: ['local' as const],
    data: [[12, 'derived']],
  }
  const fullPresentation = {
    columnOrder: [],
    hiddenColumnIds: [],
    columnWidths: {},
    frozenColumnCount: 0,
    density: 'standard' as const,
    filters: [],
    sorts: [],
  }

  it('reorders columns and realigns row data by column id', () => {
    const matrix = applySheetPresentation(baseMatrix, {
      ...fullPresentation,
      columnOrder: ['col-readonly', 'col-editable'],
    })
    expect(matrix.columns.map((column) => column.label)).toEqual([
      'Recovery',
      'Titer',
    ])
    expect(matrix.data).toEqual([['derived', 12]])
    // Row identity is untouched by presentation resequencing.
    expect(matrix.rowKeys).toEqual([rowId])
  })

  it('drops hidden columns from the display matrix only', () => {
    const matrix = applySheetPresentation(baseMatrix, {
      ...fullPresentation,
      hiddenColumnIds: ['col-readonly'],
    })
    expect(matrix.columns.map((column) => column.id)).toEqual(['col-editable'])
    expect(matrix.data).toEqual([[12]])
  })

  it('ignores unknown and duplicate order entries and appends the rest canonically', () => {
    const matrix = applySheetPresentation(
      { ...baseMatrix, columns: [...bulkColumns, third] },
      {
        ...fullPresentation,
        columnOrder: ['col-third', 'col-third', 'unknown-column'],
      },
    )
    expect(matrix.columns.map((column) => column.id)).toEqual([
      'col-third',
      'col-editable',
      'col-readonly',
    ])
  })

  it('keeps the canonical order untouched for an empty presentation', () => {
    const matrix = applySheetPresentation(baseMatrix, fullPresentation)
    expect(matrix.columns.map((column) => column.id)).toEqual([
      'col-editable',
      'col-readonly',
    ])
    expect(matrix.data).toEqual([[12, 'derived']])
  })
})

describe('clear contents with visual→physical columns (GRID-04)', () => {
  it('resolves the typed contract on the physical column behind a moved visual column', () => {
    // Visual column 0 actually shows the physical column 1 (Recovery,
    // derived): the clear must skip it even though the matrix's editable
    // column sits at visual position 1.
    const updates = clearContentsUpdates(
      bulkColumns,
      [{ from: { row: 0, col: 0 }, to: { row: 0, col: 1 } }],
      () => 'filled',
      (visual) => (visual === 0 ? 1 : 0),
    )
    expect(updates).toEqual([[0, 1, null]])
  })
})

describe('Handsontable filter ⇄ presentation.filters mapping (GRID-04)', () => {
  const columns = [{ id: 'col-a' }, { id: 'col-b' }, { id: 'col-c' }]
  const columnIds = new Set(columns.map((column) => column.id))
  const emptyPresentation = {
    columnOrder: [],
    hiddenColumnIds: [],
    columnWidths: {},
    frozenColumnCount: 0,
    density: 'standard' as const,
    filters: [],
    sorts: [],
  }

  it('maps equality-shaped plugin conditions onto canonical operators', () => {
    expect(
      hotFiltersToPresentationFilters(
        [
          {
            column: 0,
            conditions: [{ name: 'eq', args: [1_200] }],
            operation: 'conjunction',
          },
          { column: 1, conditions: [{ name: 'not_empty' }], operation: 'conjunction' },
          { column: 2, conditions: [{ name: 'neq', args: ['draft'] }] },
        ],
        columns,
      ),
    ).toEqual([
      { columnId: 'col-a', operator: 'equals', value: 1_200 },
      { columnId: 'col-b', operator: 'is-not-empty' },
      { columnId: 'col-c', operator: 'not-equals', value: 'draft' },
    ])
  })

  it('maps the checkbox true/false conditions to boolean equality', () => {
    expect(
      hotFiltersToPresentationFilters(
        [
          { column: 0, conditions: [{ name: 'true' }] },
          { column: 1, conditions: [{ name: 'false' }] },
          { column: 2, conditions: [{ name: 'empty' }] },
        ],
        columns,
      ),
    ).toEqual([
      { columnId: 'col-a', operator: 'equals', value: true },
      { columnId: 'col-b', operator: 'equals', value: false },
      { columnId: 'col-c', operator: 'is-empty' },
    ])
  })

  it('keeps non-serialisable conditions session-visual', () => {
    expect(
      hotFiltersToPresentationFilters(
        [
          // By-value checkbox list and text/date predicates have no
          // canonical counterpart.
          {
            column: 0,
            conditions: [{ name: 'by_value', args: [['x', 'y']] }],
          },
          { column: 1, conditions: [{ name: 'contains', args: ['a'] }] },
          // OR groups cannot be restored faithfully as AND entries.
          {
            column: 2,
            conditions: [
              { name: 'eq', args: [1] },
              { name: 'eq', args: [2] },
            ],
            operation: 'disjunction',
          },
          // Coordinates outside the display matrix are never writes.
          { column: 9, conditions: [{ name: 'eq', args: [1] }] },
        ],
        columns,
      ),
    ).toEqual([])
  })

  it('caps the captured filter list at the schema limit', () => {
    const stack = Array.from({ length: 40 }, (_, index) => ({
      column: 0,
      conditions: [{ name: 'eq', args: [index] }],
      operation: 'conjunction',
    }))
    expect(hotFiltersToPresentationFilters(stack, columns)).toHaveLength(32)
  })

  it('rebuilds addCondition calls, skipping hidden or unknown columns', () => {
    expect(
      presentationFiltersToHotAdditions(
        [
          { columnId: 'col-a', operator: 'equals', value: 5 },
          { columnId: 'col-a', operator: 'is-empty' },
          { columnId: 'col-retired', operator: 'equals', value: 'x' },
        ],
        columns,
      ),
    ).toEqual([
      { column: 0, name: 'eq', args: [5] },
      { column: 0, name: 'empty', args: [] },
    ])
  })

  it('round-trips captured filters through sanitize and re-apply', () => {
    const stack: HotFilterConditionStack[] = [
      {
        column: 0,
        conditions: [{ name: 'eq', args: ['ACME'] }],
        operation: 'conjunction',
      },
      { column: 2, conditions: [{ name: 'not_empty' }] },
      // Session-visual: dropped on capture, so it must not resurrect.
      { column: 1, conditions: [{ name: 'begins_with', args: ['S'] }] },
    ]
    const captured = hotFiltersToPresentationFilters(stack, columns)
    expect(captured).toHaveLength(2)
    const sanitized = sanitizeSheetPresentation(
      { ...emptyPresentation, filters: captured },
      columnIds,
    )
    const additions = presentationFiltersToHotAdditions(
      sanitized?.filters ?? [],
      columns,
    )
    // Re-capturing what was applied reproduces exactly the persisted shape.
    const reStack = new Map<
      number,
      { column: number; conditions: Array<{ name: string; args: unknown[] }> }
    >()
    for (const addition of additions) {
      const entry = reStack.get(addition.column) ?? {
        column: addition.column,
        conditions: [],
      }
      entry.conditions.push({ name: addition.name, args: addition.args })
      reStack.set(addition.column, entry)
    }
    expect(
      hotFiltersToPresentationFilters([...reStack.values()], columns),
    ).toEqual(sanitized?.filters)
  })
})
