import { describe, expect, it } from 'vitest'

import {
  parseSheetInstanceState,
  safeParseSheetInstanceState,
} from './sheet-instance'

const ids = {
  binding: '10000000-0000-4000-8000-000000000001',
  parameter: '10000000-0000-4000-8000-000000000002',
  dataset: '10000000-0000-4000-8000-000000000003',
  field: '10000000-0000-4000-8000-000000000004',
  row: '10000000-0000-4000-8000-000000000005',
}

export function validSheetInstanceState() {
  return parseSheetInstanceState({
    bindings: [
      {
        bindingId: ids.binding,
        parameterId: ids.parameter,
        kind: 'dataset',
        datasetId: ids.dataset,
        policy: { mode: 'live' },
      },
    ],
    localFields: [
      {
        fieldId: ids.field,
        key: 'observation',
        label: 'Observation',
        description: null,
        logicalType: 'text',
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
    ],
    localValues: { [ids.row]: { [ids.field]: 'independent value' } },
    calculationOverrides: {},
    presentation: {
      columnOrder: [ids.field],
      hiddenColumnIds: [],
      columnWidths: { [ids.field]: 180 },
      frozenColumnCount: 0,
      density: 'standard',
    },
    provenance: { createdFrom: 'ad_hoc' },
  })
}

describe('Sheet Instance working-state contract', () => {
  it('accepts canonical local fields and stable UUID-addressed local values', () => {
    expect(validSheetInstanceState().localValues[ids.row][ids.field]).toBe(
      'independent value',
    )
  })

  it.each([
    [
      'nil UUID',
      (value: any) =>
        (value.bindings[0].bindingId = '00000000-0000-0000-0000-000000000000'),
    ],
    [
      'unknown local field',
      (value: any) => (value.localValues[ids.row][crypto.randomUUID()] = 'x'),
    ],
    [
      'unchecked quantity metadata',
      (value: any) => (value.localFields[0].quantity = { unit: 'mg' }),
    ],
    [
      'unknown presentation key',
      (value: any) => (value.presentation.filter = {}),
    ],
    [
      'malformed override',
      (value: any) =>
        (value.calculationOverrides[ids.field] = { expression: {} }),
    ],
    [
      'duplicate binding ID',
      (value: any) =>
        value.bindings.push({
          ...value.bindings[0],
          parameterId: crypto.randomUUID(),
        }),
    ],
  ])('rejects %s', (_name, mutate) => {
    const value: any = structuredClone(validSheetInstanceState())
    mutate(value)
    expect(safeParseSheetInstanceState(value).success).toBe(false)
  })

  it('rejects oversized nested values', () => {
    const value: any = structuredClone(validSheetInstanceState())
    value.localValues[ids.row][ids.field] = 'x'.repeat(1_048_576)
    expect(safeParseSheetInstanceState(value).success).toBe(false)
  })
})
