/**
 * MOB-02 — bench reading builders.
 *
 * The database path is proved in `tests/db/bench-reading.test.ts`; these are the
 * pure fold/resolve helpers the phone form relies on: choosing the sample
 * binding, detecting a dilution field, mirroring the system out-of-range rule
 * for messaging, deriving the reported concentration, and building the exact
 * canonical planned-row fill.
 */
import { describe, expect, it } from 'vitest'

import {
  buildReadingRow,
  buildReadingValues,
  dilutionReadingField,
  isReadingOutOfRange,
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
