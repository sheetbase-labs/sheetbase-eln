import { describe, expect, it } from 'vitest'

import {
  assertPinnedSchemaVersion,
  coerceImportValue,
  datasetFieldsFromColumns,
  mapImportSheet,
  suggestImportMappings,
  type ImportTargetField,
} from './import-mapping'
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
})
