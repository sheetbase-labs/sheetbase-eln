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
    unit: { symbol: 'mg/mL', dimension: 'concentration' },
    validation: { min: 0 },
    options: [],
    relationship: null,
    computation: { mode: 'stored' },
    lifecycle: 'active',
    ...overrides,
  }
}

describe('canonical FieldDefinition contract', () => {
  it('accepts a representative numeric field with units and validation', () => {
    expect(validateFieldDefinition(field())).toEqual([])
  })

  it('requires category options to live on category fields', () => {
    const issues = validateFieldDefinition(
      field({
        options: [
          {
            id: 'option-1',
            key: 'clinical',
            label: 'Clinical',
            displayOrder: 1,
            lifecycle: 'active',
          },
        ],
      }),
    )
    expect(issues).toContainEqual({
      path: 'options',
      message: 'Controlled vocabulary options require logicalType=category.',
    })
  })

  it('requires reference fields to declare an explicit target', () => {
    const issues = validateFieldDefinition(
      field({ logicalType: 'reference', unit: null }),
    )
    expect(issues).toContainEqual({
      path: 'relationship',
      message: 'Reference fields require an explicit relationship target.',
    })
  })

  it('maps the existing Model field contract without changing durable identity', () => {
    const mapped = fieldDefinitionFromModelField({
      id: 'f-123',
      fieldName: 'source_sample',
      label: 'Source sample',
      description: 'Input material',
      logicalType: 'reference',
      nullable: false,
      defaultValue: null,
      unit: null,
      validation: {
        targetModelKey: 'sample',
        requiredState: 'released',
      },
      lifecycle: 'active',
      options: [],
    })

    expect(mapped).toMatchObject({
      fieldId: 'f-123',
      key: 'source_sample',
      logicalType: 'reference',
      cardinality: 'one',
      relationship: {
        target: { kind: 'model', modelKey: 'sample' },
        cardinality: 'one',
      },
      validation: { extensions: { requiredState: 'released' } },
      computation: { mode: 'stored' },
    })
    expect(validateFieldDefinition(mapped)).toEqual([])
  })

  it('separates durable key identity from presentation labels', () => {
    const original = field({ key: 'vector_copy_number', label: 'VCN' })
    const renamed = { ...original, label: 'Vector copy number' }

    expect(renamed.fieldId).toBe(original.fieldId)
    expect(renamed.key).toBe(original.key)
    expect(renamed.label).not.toBe(original.label)
  })
})
