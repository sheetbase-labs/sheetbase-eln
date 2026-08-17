import { describe, expect, it } from 'vitest'

import {
  canonicalSheetGridMatrix,
  parseSheetCellInput,
  validateCanonicalCell,
} from './canonical-sheet-grid'
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
