import { describe, expect, it } from 'vitest'

import {
  canonicalSheetGridMatrix,
  clearContentsUpdates,
  firstBulkChangeRejection,
  parseSheetCellInput,
  validateCanonicalCell,
} from './canonical-sheet-grid'
import type { CanonicalSheetGridColumn } from './canonical-sheet-grid'
import type { ComposedSheetSnapshot } from './sheet-composition-data'
import { validSheetInstanceState } from './sheet-instance.test'

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
