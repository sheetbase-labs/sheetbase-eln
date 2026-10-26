import { describe, expect, it } from 'vitest'

import {
  assertPinnedSchemaVersion,
  coerceImportValue,
  datasetFieldsFromColumns,
  mapImportSheet,
  suggestImportMappings,
} from './import-mapping'
import type { ImportTargetField } from './import-mapping'
import type { ScientificColumnWire } from './scientific-sheet-data'

function column(
  overrides: Partial<ScientificColumnWire> = {},
): ScientificColumnWire {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    field_name: 'ph',
    label: 'pH',
    display_order: 0,
    logical_type: 'decimal',
    nullable: true,
    unit: null,
    validation: {},
    width: null,
    options: [],
    ...overrides,
  }
}

describe('import mapping', () => {
  it('suggests mappings from header labels', () => {
    const fields = datasetFieldsFromColumns([
      column(),
      column({
        id: '22222222-2222-4222-8222-222222222222',
        field_name: 'sample',
        label: 'Sample',
        logical_type: 'text',
        display_order: 1,
      }),
    ])
    const mappings = suggestImportMappings(['sample', 'pH', 'extra'], fields)
    expect(mappings[0]).toMatchObject({ kind: 'field' })
    expect(mappings[1]).toMatchObject({ kind: 'field' })
    expect(mappings[2]).toEqual({ source: 'extra', kind: 'ignore' })
  })

  it('fails closed on invalid integer, decimal and boolean values', () => {
    const integer: ImportTargetField = {
      id: 'int',
      label: 'Count',
      logicalType: 'integer',
      nullable: true,
      kind: 'dataset-field',
    }
    expect(() => coerceImportValue(integer, '1.5')).toThrow(/Invalid integer/)
    expect(() =>
      coerceImportValue(
        { ...integer, logicalType: 'decimal', label: 'pH' },
        'nope',
      ),
    ).toThrow(/Invalid number/)
    expect(() =>
      coerceImportValue(
        { ...integer, logicalType: 'boolean', label: 'Pass' },
        'maybe',
      ),
    ).toThrow(/Invalid boolean/)
  })

  it('maps rows onto Schema field ids and records coercion errors', () => {
    const fields = datasetFieldsFromColumns([
      column({
        id: 'f-text',
        field_name: 'sample',
        label: 'Sample',
        logical_type: 'text',
      }),
      column({ id: 'f-ph', field_name: 'ph' }),
    ])
    const mappings = suggestImportMappings(['Sample', 'pH'], fields)
    const mapped = mapImportSheet(
      {
        name: 'Sheet 1',
        headers: ['Sample', 'pH'],
        rows: [
          { Sample: 'A', pH: '7.2' },
          { Sample: 'B', pH: 'bad' },
        ],
      },
      mappings,
      'schema-v1',
      () => 'row-fixed',
    )
    expect(mapped.schemaVersionId).toBe('schema-v1')
    expect(mapped.rows[0]?.values).toEqual({ 'f-text': 'A', 'f-ph': 7.2 })
    expect(mapped.errors).toEqual([
      expect.objectContaining({
        row: 2,
        code: 'coercion_failed',
        fieldId: 'f-ph',
      }),
    ])
  })

  it('rejects a Schema Version pin mismatch', () => {
    expect(() => assertPinnedSchemaVersion('ver-1', 'ver-2')).toThrow(
      /Schema Version changed/,
    )
  })

  it('never relabels numeric values when the source unit is unknown or different', () => {
    const field = datasetFieldsFromColumns([
      column({ unit: { storageUnit: 'mg/mL' } }),
    ])[0]
    const map = (sourceUnit: string | null, source = 'Concentration') =>
      mapImportSheet(
        {
          name: 'Measurements',
          headers: [source],
          rows: [{ [source]: '0.125' }],
        },
        [{ source, kind: 'field', field, sourceUnit }],
        'schema-v1',
      )
    expect(map('mg/mL').rows[0]?.values[field.id]).toBe(0.125)
    for (const unit of [null, 'g/L', 'cells/mL', 'MG/ML']) {
      const result = map(unit)
      expect(result.rows[0]?.values).toEqual({})
      expect(result.errors[0]?.message).toMatch(
        /Declare the source unit|Convert the source values/,
      )
    }
    expect(map(null, 'Concentration (g/L)').errors[0]?.message).toContain(
      'source unit g/L',
    )
    expect(map(null, 'Concentration [mg/mL]').rows[0]?.values[field.id]).toBe(
      0.125,
    )
  })
})

describe('suggestImportMappings with a unit annotation', () => {
  it('matches a header whose trailing (unit) names a field', () => {
    const fields = [
      {
        id: 'f1',
        key: 'titre',
        label: 'Capsid titre',
        logicalType: 'decimal',
        nullable: true,
        unit: 'vg/mL',
        kind: 'dataset-field' as const,
      },
    ]
    const [mapping] = suggestImportMappings(['Capsid titre (vg/mL)'], fields)
    expect(mapping).toMatchObject({ kind: 'field', field: { id: 'f1' } })
  })
})
