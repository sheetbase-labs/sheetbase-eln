/**
 * MOB-02 — bench reading builders.
 *
 * The database path is proved in `tests/db/bench-reading.test.ts`; these are the
 * pure fold/resolve helpers the phone form relies on: choosing the sample
 * binding, detecting a dilution field, mirroring the system out-of-range rule
 * for messaging, deriving the reported concentration, and building the exact
 * canonical planned-row fill.
 */
import { describe, expect, it, vi } from 'vitest'

import { createDataClient } from './data-client'
import {
  attachPhotoToSample,
  buildReadingRow,
  buildReadingValues,
  dilutionReadingField,
  isReadingOutOfRange,
  listReadingFields,
  outOfRangeRule,
  readingCommitErrorMessage,
  readingFieldUnit,
  reportedConcentration,
  sampleBindingField,
} from './readings-data'
import type { ReadingFieldWire } from './readings-data'

const SAMPLE_REF = 'field-sample-ref'
const SAMPLE_TEXT = 'field-sample-text'
const TITRE = 'field-titre'
const DILUTION = 'field-dilution'
const NOTE = 'field-note'

function field(overrides: Partial<ReadingFieldWire>): ReadingFieldWire {
  return {
    field_id: 'field',
    key: 'key',
    label: 'Label',
    logical_type: 'text',
    nullable: true,
    display_order: 0,
    quantity: null,
    validation: {},
    relationship: null,
    ...overrides,
  }
}

const fields: ReadingFieldWire[] = [
  field({
    field_id: SAMPLE_REF,
    key: 'sample_link',
    label: 'Sample',
    logical_type: 'reference',
    relationship: { target: { kind: 'model', modelKey: 'sample' } },
  }),
  field({
    field_id: SAMPLE_TEXT,
    key: 'sample',
    label: 'Sample',
    logical_type: 'text',
  }),
  field({
    field_id: TITRE,
    key: 'capsid_titre',
    label: 'Capsid titre',
    logical_type: 'decimal',
    quantity: { symbol: '×10¹⁰ vg/mL', storageUnit: '1' },
    validation: {
      extensions: { systemFlags: { out_of_range: { min: 2, max: 4 } } },
    },
  }),
  field({
    field_id: DILUTION,
    key: 'dilution',
    label: 'Dilution',
    logical_type: 'integer',
  }),
  field({ field_id: NOTE, key: 'note', label: 'Note', logical_type: 'text' }),
]

const titreField = fields.find((f) => f.field_id === TITRE)!
const dilutionField = fields.find((f) => f.field_id === DILUTION)!

describe('reading field transport', () => {
  it('decodes selected fields without losing scientific metadata keys', async () => {
    const scientificMetadata = {
      symbol: 'ng/mL',
      ['__proto__']: { calibration: 'reference-lot-7' },
    }

    const client = createDataClient(async (input) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        'http://eln.test',
      )

      expect(url.pathname).toBe('/api/db/dataset_schema_version_fields')
      expect(url.searchParams.get('schema_version_id')).toBe('eq.version/7')

      return Response.json([
        field({ field_id: TITRE, quantity: scientificMetadata }),
        fields[0],
      ])
    })

    const result = await listReadingFields(client, 'version/7')

    expect(result[0].quantity).toEqual(scientificMetadata)
    expect(Object.hasOwn(result[0].quantity ?? {}, '__proto__')).toBe(true)
    expect(readingFieldUnit(result[0])).toBe('ng/mL')
    expect(sampleBindingField(result)?.field_id).toBe(SAMPLE_REF)
  })

  it('rejects malformed quantity metadata at the HTTP read boundary', async () => {
    const client = createDataClient(async () =>
      Response.json([{ ...fields[2], quantity: { symbol: 7 } }]),
    )

    await expect(listReadingFields(client, 'version-7')).rejects.toThrow()
  })
})

describe('reading field resolution', () => {
  it('binds the sample by reference before falling back to a sample text field', () => {
    expect(sampleBindingField(fields)?.field_id).toBe(SAMPLE_REF)
    const withoutReference = fields.filter((f) => f.field_id !== SAMPLE_REF)
    expect(sampleBindingField(withoutReference)?.field_id).toBe(SAMPLE_TEXT)
  })

  it('recognises a sample text field by key or label', () => {
    const byLabel = [
      field({
        field_id: SAMPLE_TEXT,
        key: 'specimen',
        label: 'Sample',
        logical_type: 'text',
      }),
    ]

    expect(sampleBindingField(byLabel)?.field_id).toBe(SAMPLE_TEXT)
  })

  it('finds the numeric dilution field and ignores non-numeric matches', () => {
    expect(dilutionReadingField(fields)?.field_id).toBe(DILUTION)

    const textDilution = [
      field({ field_id: 'x', key: 'dilution', label: 'Dilution' }),
    ]

    expect(dilutionReadingField(textDilution)).toBeNull()
  })

  it('reads the field unit from quantity metadata', () => {
    expect(readingFieldUnit(titreField)).toBe('×10¹⁰ vg/mL')
    expect(readingFieldUnit(dilutionField)).toBeNull()
  })
})

describe('out-of-range detection', () => {
  it('reads only the soft systemFlags rule, not hard validation bounds', () => {
    expect(outOfRangeRule(titreField)).toEqual({ min: 2, max: 4 })

    const hardOnly = field({
      logical_type: 'decimal',
      validation: { min: 0, max: 1 },
    })

    expect(outOfRangeRule(hardOnly)).toBeNull()
  })

  it('flags values outside the rule without rejecting them', () => {
    expect(isReadingOutOfRange(titreField, 9)).toBe(true)
    expect(isReadingOutOfRange(titreField, 1)).toBe(true)
    expect(isReadingOutOfRange(titreField, 3)).toBe(false)
  })

  it('keeps a valid bound when the other soft bound is malformed', () => {
    const partial = field({
      validation: {
        extensions: { systemFlags: { out_of_range: { min: '2', max: 7 } } },
      },
    })

    expect(outOfRangeRule(partial)).toEqual({ min: undefined, max: 7 })
    expect(isReadingOutOfRange(partial, 1)).toBe(false)
    expect(isReadingOutOfRange(partial, 7)).toBe(false)
    expect(isReadingOutOfRange(partial, 8)).toBe(true)
    expect(
      outOfRangeRule(
        field({ validation: { extensions: { systemFlags: 'unavailable' } } }),
      ),
    ).toBeNull()
  })
})

describe('derived concentration', () => {
  it('multiplies the raw reading by the dilution factor', () => {
    expect(reportedConcentration(3.2, 10)).toBeCloseTo(32)
    expect(reportedConcentration(3.2, null)).toBe(3.2)
    expect(reportedConcentration(3.2, undefined)).toBe(3.2)
  })
})

describe('buildReadingValues', () => {
  it('folds the measurement, sample identity, dilution and note', () => {
    const values = buildReadingValues({
      fields,
      measurementFieldId: TITRE,
      measurementValue: 3.2,
      sample: { id: 'sample-uuid', identifier: 'SMP-0001' },
      dilutionFieldId: DILUTION,
      dilutionFactor: 10,
      noteFieldId: NOTE,
      note: '  bench 4  ',
    })

    expect(values).toEqual({
      [TITRE]: 3.2,
      [SAMPLE_REF]: 'sample-uuid',
      [DILUTION]: 10,
      [NOTE]: 'bench 4',
    })
  })

  it('uses the stable identifier for a sample text binding', () => {
    const values = buildReadingValues({
      fields: fields.filter((f) => f.field_id !== SAMPLE_REF),
      measurementFieldId: TITRE,
      measurementValue: 1,
      sample: { id: 'sample-uuid', identifier: 'SMP-0001' },
      dilutionFieldId: null,
      dilutionFactor: null,
    })

    expect(values[SAMPLE_TEXT]).toBe('SMP-0001')
    expect(values[SAMPLE_REF]).toBeUndefined()
  })

  it('refuses a non-numeric measurement field', () => {
    expect(() =>
      buildReadingValues({
        fields,
        measurementFieldId: NOTE,
        measurementValue: 1,
        sample: { id: 's', identifier: 'SMP-1' },
      }),
    ).toThrow(/numeric measurement field/)
  })

  it('refuses a fractional factor for an integer dilution field', () => {
    expect(() =>
      buildReadingValues({
        fields,
        measurementFieldId: TITRE,
        measurementValue: 3,
        sample: { id: 's', identifier: 'SMP-1' },
        dilutionFieldId: DILUTION,
        dilutionFactor: 2.5,
      }),
    ).toThrow(/whole number/)
  })

  it('refuses a non-positive dilution factor', () => {
    expect(() =>
      buildReadingValues({
        fields,
        measurementFieldId: TITRE,
        measurementValue: 3,
        sample: { id: 's', identifier: 'SMP-1' },
        dilutionFieldId: DILUTION,
        dilutionFactor: 0,
      }),
    ).toThrow(/greater than zero/)
  })
})

describe('buildReadingRow', () => {
  it('builds a canonical create carrying the planned key', () => {
    const row = buildReadingRow({
      fields,
      rowId: '00000000-0000-4000-8000-0000000000aa',
      plannedKey: '  A1  ',
      measurementFieldId: TITRE,
      measurementValue: 3.2,
      sample: { id: 'sample-uuid', identifier: 'SMP-0001' },
      dilutionFieldId: DILUTION,
      dilutionFactor: 10,
    })

    expect(row).toEqual({
      operation: 'create',
      rowId: '00000000-0000-4000-8000-0000000000aa',
      plannedKey: 'A1',
      values: {
        [TITRE]: 3.2,
        [SAMPLE_REF]: 'sample-uuid',
        [DILUTION]: 10,
      },
    })
  })

  it('refuses an empty planned key', () => {
    expect(() =>
      buildReadingRow({
        fields,
        plannedKey: '   ',
        measurementFieldId: TITRE,
        measurementValue: 1,
        sample: { id: 's', identifier: 'SMP-1' },
      }),
    ).toThrow(/usable key/)
  })
})

describe('readingCommitErrorMessage', () => {
  it('names the field and explains the code', () => {
    const message = readingCommitErrorMessage(
      {
        ok: false,
        errors: [{ fieldId: TITRE, code: 'numeric_validation' }],
      },
      fields,
    )

    expect(message).toContain('Capsid titre')
    expect(message).toContain('outside')
  })

  it('returns null for a successful commit and surfaces unknown codes', () => {
    expect(readingCommitErrorMessage({ ok: true })).toBeNull()
    expect(
      readingCommitErrorMessage({
        ok: false,
        errors: [{ code: 'brand_new_rule' }],
      }),
    ).toContain('brand_new_rule')
  })
})

describe('reading photo evidence', () => {
  it('decodes upload identity before uploading bytes and linking the photo', async () => {
    const requests: string[] = []
    let validIdentity = false

    const transport: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString()
      requests.push(`${init?.method} ${url}`)

      if (url === '/api/files/upload-authorize') {
        return Response.json({
          fileRecordId: validIdentity ? 'photo-record' : 42,
          fileIdentifier: 'FILE-7',
        })
      }

      if (url === '/api/files/photo-record/upload') {
        expect(init?.body).toBe(file)

        return new Response(null, { status: 204 })
      }

      if (url === '/api/db/rpc/create_record_link') {
        expect(await new Response(init?.body).json()).toMatchObject({
          p_source_record_id: 'sample-record',
          p_target_record_id: 'photo-record',
          p_target_identifier: 'FILE-7',
          p_link_type: 'file',
        })

        return Response.json({})
      }

      throw new Error(`Unexpected request ${url}`)
    }

    const file = new File(['image'], 'bench.png', { type: 'image/png' })
    const client = createDataClient(transport)

    const input = {
      sampleRecordId: 'sample-record',
      projectId: 'project',
      file,
    }

    vi.stubGlobal('fetch', transport)

    try {
      await expect(attachPhotoToSample(client, input)).rejects.toThrow()
      expect(requests).toEqual(['POST /api/files/upload-authorize'])
      requests.length = 0
      validIdentity = true

      await expect(attachPhotoToSample(client, input)).resolves.toMatchObject({
        fileRecordId: 'photo-record',
        fileIdentifier: 'FILE-7',
        byteSize: 5,
      })
      expect(requests).toEqual([
        'POST /api/files/upload-authorize',
        'PUT /api/files/photo-record/upload',
        'POST /api/db/rpc/create_record_link',
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
