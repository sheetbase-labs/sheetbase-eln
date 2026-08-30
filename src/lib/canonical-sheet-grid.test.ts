import { describe, expect, it } from 'vitest'

import {
  canonicalSheetGridMatrix,
  parseSheetCellInput,
  validateCanonicalCell,
} from './canonical-sheet-grid'
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
