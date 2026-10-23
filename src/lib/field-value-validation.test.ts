import { describe, expect, it } from 'vitest'
import type { FieldDefinition } from './field-definition'
import {
  fieldDisplayUnit,
  fieldScalarError,
  parseQuantityNumericValue,
  validateFieldValue,
} from './field-value-validation'

const ACTIVE_OPTION_ID = '40000000-0000-4000-8000-000000000001'
const RETIRED_OPTION_ID = '40000000-0000-4000-8000-000000000003'

/** The generated Record form stores an embedded category option's key. */
const embeddedCategory: NonNullable<FieldDefinition['category']> = {
  kind: 'embedded',
  options: [
    {
      id: ACTIVE_OPTION_ID,
      key: 'cho_k1',
      label: 'CHO-K1',
      displayOrder: 0,
      lifecycle: 'active',
    },
    {
      id: RETIRED_OPTION_ID,
      key: 'hek293',
      label: 'HEK293',
      displayOrder: 1,
      lifecycle: 'retired',
    },
  ],
}

function categoryField(
  overrides: Partial<FieldDefinition> = {},
): FieldDefinition {
  return {
    fieldId: 'cell_line',
    key: 'cell_line',
    label: 'Cell line',
    description: null,
    logicalType: 'category',
    nullable: false,
    defaultValue: null,
    cardinality: 'one',
    quantity: null,
    validation: {},
    category: embeddedCategory,
    relationship: null,
    computation: { mode: 'stored' },
    lifecycle: 'active',
    ...overrides,
  }
}

describe('category scalar contract', () => {
  it('accepts an active embedded option key, not only its UUID', () => {
    const field = categoryField()
    // The server matches the option key (`o.key = value`), so the form's select
    // value must validate as a category value.
    expect(fieldScalarError(field, 'cho_k1')).toBeNull()
    expect(validateFieldValue(field, 'cho_k1')).toBeNull()
    expect(validateFieldValue(field, ACTIVE_OPTION_ID)).toBeNull()
  })

  it('rejects retired and unknown values with the same codes as the Sheet path', () => {
    const field = categoryField()
    expect(fieldScalarError(field, 'hek293')).toBe('invalid_value')
    expect(fieldScalarError(field, RETIRED_OPTION_ID)).toBe(
      'invalid_category_option',
    )
    expect(fieldScalarError(field, 'Nope')).toBe('invalid_value')
    expect(fieldScalarError(field, 42)).toBe('invalid_value')
  })

  it('does not treat a non-category value as an option', () => {
    const text = categoryField({ logicalType: 'text', category: null })
    expect(fieldScalarError(text, 'cho_k1')).toBeNull()
  })
})

describe('quantity storage-unit safety', () => {
  const field = categoryField({
    logicalType: 'decimal',
    category: null,
    quantity: {
      kind: 'mass',
      dimension: 'mass',
      storageUnit: 'mg',
      preferredDisplayUnit: 'g',
      allowedInputUnits: ['g', 'mg', 'Mg'],
    },
  })

  it('accepts bare and storage-unit magnitudes without changing their scale', () => {
    for (const input of [10, '10', '10 mg', '10mg', ' 10 mg ']) {
      expect(parseQuantityNumericValue(field, input)).toBe(10)
    }
    expect(parseQuantityNumericValue(field, '1,234.5 mg')).toBe(1234.5)
    expect(
      parseQuantityNumericValue(
        { ...field, logicalType: 'integer' },
        '1,234 mg',
      ),
    ).toBe(1234)
  })

  it('rejects other units and case changes even when metadata lists them', () => {
    for (const input of ['1 g', '1 Mg', '1 MG', '1 µg']) {
      for (const logicalType of ['decimal', 'integer'] as const) {
        const definition = { ...field, logicalType }
        const parsed = parseQuantityNumericValue(definition, input)
        expect(parsed).toBe(input)
        expect(validateFieldValue(definition, parsed)).toBe('invalid_value')
      }
    }
  })

  it('labels stored magnitudes with storage units, retaining only the legacy fallback', () => {
    expect(fieldDisplayUnit(field, 'kg')).toBe('mg')
    expect(fieldDisplayUnit({ ...field, quantity: null }, 'kg')).toBe('kg')
    expect(fieldDisplayUnit({ ...field, quantity: null })).toBeNull()
  })
})
