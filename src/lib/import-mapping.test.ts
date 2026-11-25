import { describe, expect, it } from 'vitest'

import {
  assertPinnedSchemaVersion,
  coerceImportValue,
  datasetFieldsFromColumns,
  linkIdentifiersToResolve,
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

  it('never relabels numeric values when the source unit is missing or of another kind', () => {
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
    // The same kind of unit is sent as typed, for the database to convert.
    expect(map('µg/mL').rows[0]?.values[field.id]).toBe('0.125 µg/mL')
    expect(map('mg/ml').rows[0]?.values[field.id]).toBe(0.125)

    for (const unit of [null, 'cells/mL', 'MG/ML']) {
      const result = map(unit)
      expect(result.rows[0]?.values).toEqual({})
      expect(result.errors[0]?.message).toMatch(
        /Declare the source unit|can't be converted/,
      )
    }

    // g/L and mg/mL are the same size, so nothing needs converting.
    expect(map(null, 'Concentration (g/L)').rows[0]?.values[field.id]).toBe(
      0.125,
    )
    expect(map(null, 'Concentration (ng/mL)').rows[0]?.values[field.id]).toBe(
      '0.125 ng/mL',
    )
    expect(map(null, 'Concentration (cells/mL)').errors[0]?.message).toContain(
      'source unit cells/mL',
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

  describe('link columns', () => {
    const SAMPLE_ID = '5b6a4c1e-6a43-4d6f-8f29-1e6b0c1d9a01'

    const link: ImportTargetField = {
      id: 'sample',
      key: 'sample',
      label: 'Sample',
      logicalType: 'reference',
      nullable: true,
      targetModelKey: 'sample',
      kind: 'dataset-field',
    }

    const sheet = {
      name: 'Sheet1',
      headers: ['Sample'],
      rows: [
        { Sample: 'SMP-2231' },
        { Sample: 'smp-2231' },
        { Sample: SAMPLE_ID },
        { Sample: 'SMP-9999' },
        { Sample: '' },
      ],
    }

    const mappings = [{ source: 'Sample', kind: 'field' as const, field: link }]

    it('asks for each identifier once, in one case, and skips ids and blanks', () => {
      expect(linkIdentifiersToResolve(sheet, mappings)).toEqual([
        'SMP-2231',
        'SMP-9999',
      ])
    })

    it('turns identifiers into record ids and flags the unknown ones', () => {
      const mapped = mapImportSheet(
        sheet,
        mappings,
        null,
        () => 'row',
        new Map([['SMP-2231', SAMPLE_ID]]),
      )

      expect(mapped.rows.map((row) => row.values.sample)).toEqual([
        SAMPLE_ID,
        SAMPLE_ID,
        SAMPLE_ID,
        undefined,
        null,
      ])

      expect(mapped.errors).toEqual([
        expect.objectContaining({
          row: 4,
          fieldId: 'sample',
          code: 'unknown_record',
          message: expect.stringContaining('SMP-9999'),
        }),
      ])
    })
  })
})
