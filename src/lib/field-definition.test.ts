import { describe, expect, it } from 'vitest'

import {
  fieldDefinitionFromModelField,
  validateFieldDefinition,
} from './field-definition'
import type { FieldDefinition } from './field-definition'

function field(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    fieldId: 'field-1',
    key: 'concentration',
    label: 'Concentration',
    description: null,
    logicalType: 'decimal',
    nullable: true,
    defaultValue: null,
    cardinality: 'one',
    quantity: {
      kind: 'mass_concentration',
      dimension: 'mass/volume',
      storageUnit: 'mg/mL',
      allowedInputUnits: ['mg/mL', 'g/L'],
    },
    validation: { min: 0 },
    category: null,
    relationship: null,
    computation: { mode: 'stored' },
    lifecycle: 'active',
    ...overrides,
  }
}

describe('canonical FieldDefinition contract', () => {
  it('accepts a representative scientific quantity', () => {
    expect(validateFieldDefinition(field())).toEqual([])
  })

  it('rejects quantity semantics on non-numeric fields', () => {
    expect(
      validateFieldDefinition(field({ logicalType: 'text' })),
    ).toContainEqual({
      path: 'quantity',
      message:
        'Quantity semantics are only valid for integer or decimal fields.',
    })
  })

  it('supports embedded and governed category sources', () => {
    expect(
      validateFieldDefinition(
        field({
          logicalType: 'category',
          quantity: null,
          category: {
            kind: 'embedded',
            options: [
              {
                id: 'option-1',
                key: 'pass',
                label: 'Pass',
                displayOrder: 1,
                lifecycle: 'active',
              },
            ],
          },
        }),
      ),
    ).toEqual([])

    expect(
      validateFieldDefinition(
        field({
          logicalType: 'category',
          quantity: null,
          category: { kind: 'vocabulary', vocabularyId: 'qc-outcome' },
        }),
      ),
    ).toEqual([])
  })

  it('maps existing Model fields without changing durable identity', () => {
    const mapped = fieldDefinitionFromModelField({
      id: 'f-123',
      fieldName: 'source_sample',
      label: 'Source sample',
      description: 'Input material',
      logicalType: 'reference',
      nullable: false,
      defaultValue: null,
      unit: null,
      validation: { targetModelKey: 'sample', requiredState: 'released' },
      lifecycle: 'active',
      options: [],
    })

    expect(mapped).toMatchObject({
      fieldId: 'f-123',
      key: 'source_sample',
      quantity: null,
      relationship: {
        target: { kind: 'model', modelKey: 'sample' },
        cardinality: 'one',
      },
      validation: { extensions: { requiredState: 'released' } },
    })
    expect(validateFieldDefinition(mapped)).toEqual([])
  })

  it('projects legacy unit metadata without inventing scientific meaning', () => {
    const mapped = fieldDefinitionFromModelField({
      id: 'f-quantity',
      fieldName: 'titre',
      label: 'Titre',
      description: null,
      logicalType: 'decimal',
      nullable: true,
      defaultValue: null,
      unit: { symbol: 'TU/mL' },
      validation: {},
      lifecycle: 'active',
      options: [],
    })

    expect(mapped.quantity).toEqual({
      kind: 'legacy-unspecified',
      dimension: 'legacy-unspecified',
      storageUnit: 'TU/mL',
    })
  })

  it('uses explicit persisted semantics ahead of legacy compatibility metadata', () => {
    const mapped = fieldDefinitionFromModelField({
      id: 'f-explicit',
      fieldName: 'input_sample',
      label: 'Input sample',
      description: null,
      logicalType: 'reference',
      nullable: true,
      defaultValue: null,
      unit: null,
      quantity: null,
      validation: { targetModelKey: 'sample' },
      cardinality: 'one',
      categorySource: null,
      relationship: {
        target: { kind: 'model', modelKey: 'sample' },
        cardinality: 'one',
      },
      lifecycle: 'active',
      options: [],
    })

    expect(mapped.relationship).toEqual({
      target: { kind: 'model', modelKey: 'sample' },
      cardinality: 'one',
    })
  })

  it('keeps durable key identity separate from labels', () => {
    const original = field({ key: 'vector_copy_number', label: 'VCN' })
    const renamed = { ...original, label: 'Vector copy number' }

    expect(renamed.fieldId).toBe(original.fieldId)
    expect(renamed.key).toBe(original.key)
    expect(renamed.label).not.toBe(original.label)
  })
})
