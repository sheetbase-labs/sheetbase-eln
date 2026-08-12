import { describe, expect, it } from 'vitest'

import {
  displayModelFieldValue,
  modelFieldValuesFromInput,
  parseModelFieldInput,
} from './model-fields'
import type {
  ModelFieldDefinition,
  ModelFieldLogicalType,
} from './model-fields'

function field(
  logicalType: ModelFieldLogicalType,
  overrides: Partial<ModelFieldDefinition> = {},
): ModelFieldDefinition {
  return {
    id: `field-${logicalType}`,
    modelKey: 'sample',
    fieldName: logicalType,
    label: logicalType,
    description: null,
    displayOrder: 1,
    logicalType,
    nullable: true,
    defaultValue: null,
    unit: null,
    validation: {},
    lifecycle: 'active',
    options: [],
    ...overrides,
  }
}

describe('model field values', () => {
  it('parses blank nullable and required values without inventing a value', () => {
    expect(parseModelFieldInput(field('text'), '')).toBeNull()
    expect(parseModelFieldInput(field('text', { nullable: false }), '')).toBe(
      '',
    )
  })

  it('parses booleans, whole numbers and decimals', () => {
    expect(parseModelFieldInput(field('boolean'), true)).toBe(true)
    expect(parseModelFieldInput(field('integer'), '42')).toBe(42)
    expect(parseModelFieldInput(field('decimal'), '0.125')).toBe(0.125)
  })

  it('omits blank create values so server defaults remain authoritative', () => {
    const definitions = [
      field('text', { fieldName: 'with_default', defaultValue: 'planned' }),
      field('text', { fieldName: 'required', nullable: false }),
      field('boolean', { fieldName: 'approved', defaultValue: true }),
    ]

    expect(modelFieldValuesFromInput(definitions, {}, true)).toEqual({})
    expect(modelFieldValuesFromInput(definitions, {}, false)).toEqual({
      with_default: null,
      required: '',
      approved: false,
    })
  })

  it('sends false for a required boolean without a server default', () => {
    const definitions = [
      field('boolean', {
        fieldName: 'confirmed',
        nullable: false,
        defaultValue: null,
      }),
    ]

    expect(modelFieldValuesFromInput(definitions, {}, true)).toEqual({
      confirmed: false,
    })
  })
})

describe('model field display values', () => {
  it('displays blank values and booleans consistently', () => {
    expect(displayModelFieldValue(field('text'), null)).toBe('—')
    expect(displayModelFieldValue(field('text'), undefined)).toBe('—')
    expect(displayModelFieldValue(field('boolean'), true)).toBe('Yes')
    expect(displayModelFieldValue(field('boolean'), false)).toBe('No')
  })

  it('uses category labels while retaining unknown stored keys', () => {
    const definition = field('category', {
      options: [
        {
          id: 'option-1',
          key: 'clinical',
          label: 'Clinical material',
          displayOrder: 1,
          lifecycle: 'active',
        },
      ],
    })
    expect(displayModelFieldValue(definition, 'clinical')).toBe(
      'Clinical material',
    )
    expect(displayModelFieldValue(definition, 'legacy')).toBe('legacy')
  })

  it('displays references unchanged and appends unit symbols', () => {
    expect(displayModelFieldValue(field('reference'), 'SMP-2026-0042')).toBe(
      'SMP-2026-0042',
    )
    expect(
      displayModelFieldValue(
        field('decimal', { unit: { symbol: 'mg/mL' } }),
        2.5,
      ),
    ).toBe('2.5 mg/mL')
  })
})
