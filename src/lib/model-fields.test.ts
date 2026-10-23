import { describe, expect, it } from 'vitest'

import type { DataClient } from './data-client'
import {
  createModelFieldWithSemantics,
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
    quantity: null,
    validation: {},
    cardinality: 'one',
    categorySource: null,
    relationship: null,
    lifecycle: 'active',
    options: [],
    definition: undefined,
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
describe('model field semantics flow', () => {
  it('parses quantity-unit input with the shared numeric coercion', () => {
    const definition = field('decimal', {
      quantity: {
        kind: 'concentration',
        dimension: 'mass/volume',
        storageUnit: 'mg/mL',
        allowedInputUnits: ['mg/mL', 'µg/mL'],
      },
    })
    expect(parseModelFieldInput(definition, '2.5 mg/mL')).toBe(2.5)
    expect(parseModelFieldInput(definition, '2.5 µg/mL')).toBe('2.5 µg/mL')
    expect(parseModelFieldInput(definition, 'nope')).toBe('nope')
  })

  it('displays the storage unit without relabelling the raw magnitude', () => {
    expect(
      displayModelFieldValue(
        field('decimal', {
          unit: { symbol: 'g/L' },
          quantity: {
            kind: 'concentration',
            dimension: 'mass/volume',
            storageUnit: 'mg/mL',
            preferredDisplayUnit: 'µg/mL',
          },
        }),
        2.5,
      ),
    ).toBe('2.5 mg/mL')
  })

  it('drafts, configures, options and activates using only existing RPCs', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        if (name === 'create_model_field') return { id: 'definition-1' }
        return { id: 'definition-1' }
      },
    } as unknown as DataClient
    await createModelFieldWithSemantics(client, {
      workspaceId: 'workspace-1',
      modelKey: 'sample',
      fieldName: 'concentration',
      label: 'Concentration',
      logicalType: 'decimal',
      nullable: true,
      defaultValue: null,
      validation: { min: 0, pattern: '^\\d' },
      unit: { symbol: 'mg/mL' },
      description: null,
      options: [],
      semantics: {
        quantity: {
          kind: 'concentration',
          dimension: 'mass/volume',
          storageUnit: 'mg/mL',
        },
        cardinality: 'one',
        categorySource: null,
        relationship: null,
      },
    })
    expect(calls.map((call) => call.name)).toEqual([
      'create_model_field',
      'configure_model_field_semantics',
      'activate_model_field',
    ])
    // The kernel `pattern` persists under the server `regex` key.
    expect(calls[0].args.p_validation).toEqual({ min: 0, regex: '^\\d' })
    expect(calls[1].args).toMatchObject({
      p_definition_id: 'definition-1',
      p_quantity: {
        kind: 'concentration',
        dimension: 'mass/volume',
        storageUnit: 'mg/mL',
      },
      p_cardinality: 'one',
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
