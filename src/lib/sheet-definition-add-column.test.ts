import { describe, expect, it } from 'vitest'

import { parseSheetDefinitionConfiguration } from './sheet-definition'
import { addSheetColumn, columnKeyFor } from './sheet-definition-add-column'

const ID = '00000000-0000-4000-8000-0000000000a1'
const OTHER = '00000000-0000-4000-8000-0000000000a2'

function base() {
  return parseSheetDefinitionConfiguration({
    columns: [
      {
        id: ID,
        field: {
          key: 'condition',
          label: 'Condition',
          fieldId: ID,
          category: null,
          nullable: false,
          quantity: null,
          lifecycle: 'active',
          validation: {},
          cardinality: 'one',
          computation: { mode: 'stored' },
          description: null,
          logicalType: 'reference',
          defaultValue: null,
          relationship: {
            target: { kind: 'model', modelKey: 'material' },
            cardinality: 'one',
          },
        },
        source: { kind: 'declared' },
      },
    ],
    joins: [],
    actions: [],
    bindings: [],
    parameters: [],
    rowIdentity: { kind: 'local', columnIds: [ID] },
    calculations: [],
    presentation: {
      sorts: [],
      density: 'standard',
      filters: [],
      columnOrder: [ID],
      columnWidths: {},
      hiddenColumnIds: [],
      frozenColumnCount: 1,
    },
    formatVersion: 1,
    writeBackRules: [],
  })
}

describe('addSheetColumn', () => {
  it('appends a typed column, shown last, with its unit and range', () => {
    const next = addSheetColumn(
      base(),
      {
        label: 'Max ΔP',
        type: 'decimal',
        unit: 'bar',
        required: true,
        max: 1.5,
      },
      () => OTHER,
    )

    expect(next.columns.map((c) => c.id)).toEqual([ID, OTHER])
    expect(next.presentation.columnOrder).toEqual([ID, OTHER])

    const added = next.columns[1]

    expect(added.field.label).toBe('Max ΔP')
    expect(added.field.nullable).toBe(false)
    expect(added.field.quantity?.storageUnit).toBe('bar')
    expect(added.field.validation).toEqual({ max: 1.5 })
    expect(added.source.kind).toBe('declared')
  })

  it('ignores a unit and range on a text column', () => {
    const next = addSheetColumn(
      base(),
      { label: 'Note', type: 'text', unit: 'bar', required: false, min: 1 },
      () => OTHER,
    )

    expect(next.columns[1].field.quantity).toBeNull()
    expect(next.columns[1].field.validation).toEqual({})
  })

  it('refuses an empty or repeated name', () => {
    expect(() =>
      addSheetColumn(base(), { label: ' ', type: 'text', required: false }),
    ).toThrow(/needs a name/)
    expect(() =>
      addSheetColumn(base(), {
        label: 'condition',
        type: 'text',
        required: false,
      }),
    ).toThrow(/already in the sheet/)
  })
})

describe('columnKeyFor', () => {
  it('joins words, drops marks and avoids a taken key', () => {
    expect(columnKeyFor('Turbidity out (NTU)', new Set())).toBe(
      'turbidity_out_ntu',
    )
    expect(columnKeyFor('Load', new Set(['load']))).toBe('load_2')
    expect(columnKeyFor('???', new Set())).toBe('column')
    expect(columnKeyFor('Max ΔP', new Set())).toBe('max_p')
    expect(columnKeyFor('3 day count', new Set())).toBe('column_3_day_count')
  })
})
