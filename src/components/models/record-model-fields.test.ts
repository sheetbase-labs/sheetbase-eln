import { describe, expect, it } from 'vitest'
import {
  diffModelVersions,
  fieldSection,
  fieldTypeLabel,
  groupFieldsBySection,
  summariseChanges,
  UNSECTIONED,
} from './record-model-fields'
import type { ModelVersionField } from './record-model-fields'
import type { ModelMetadataPatch } from '#/lib/model-fields'
import { recordModelVersionSchema } from '#/lib/record-model-versions'

function field(over: ModelMetadataPatch<ModelVersionField>): ModelVersionField {
  return {
    id: 'f1',
    field_name: 'vials',
    label: 'Vials',
    logical_type: 'integer',
    nullable: false,
    display_order: 0,
    lifecycle: 'active',
    validation: {},
    cardinality: 'one',
    ...over,
  }
}

function definition(fields: ModelVersionField[]) {
  return { fields }
}

describe('record model field helpers', () => {
  it('validates version metadata while retaining scientific keys and omitted defaults', () => {
    const scientific = Object.fromEntries([['__proto__', { nested: 7 }]])

    const version = {
      id: '10000000-0000-4000-8000-000000000001',
      model_id: '10000000-0000-4000-8000-000000000002',
      workspace_id: '10000000-0000-4000-8000-000000000003',
      version: 1,
      revision: 1,
      lifecycle: 'draft',
      reason: '',
      created_at: '2026-11-09T12:00:00Z',
      created_by_user_id: null,
      published_at: null,
      ...scientific,
      definition: {
        ...scientific,
        fields: [
          {
            ...field({ id: '10000000-0000-4000-8000-000000000004' }),
            ...scientific,
            validation: { min: 0, ...scientific },
            quantity: {
              kind: 'mass',
              dimension: 'mass',
              storageUnit: 'g',
              ...scientific,
            },
          },
        ],
      },
    }

    const decoded = recordModelVersionSchema.parse(version)
    expect(decoded).toEqual(version)
    expect(Object.hasOwn(decoded, '__proto__')).toBe(true)
    expect(Object.hasOwn(decoded.definition, '__proto__')).toBe(true)
    expect(Object.hasOwn(decoded.definition.fields[0], '__proto__')).toBe(true)
    expect(
      Object.hasOwn(decoded.definition.fields[0].quantity ?? {}, '__proto__'),
    ).toBe(true)
    expect(Object.hasOwn(decoded.definition.fields[0], 'default_value')).toBe(
      false,
    )
    expect(
      recordModelVersionSchema.safeParse({
        ...version,
        definition: {
          fields: [{ ...version.definition.fields[0], decimal_places: 'two' }],
        },
      }).success,
    ).toBe(false)
  })

  it('falls back to the default section', () => {
    expect(fieldSection(field({}))).toBe(UNSECTIONED)
    expect(fieldSection(field({ section: 'Identity' }))).toBe('Identity')
  })

  it('labels numbers with their decimal places', () => {
    expect(fieldTypeLabel(field({}))).toBe('Number, 0 dp')
    expect(fieldTypeLabel(field({ decimal_places: 2 }))).toBe('Number, 2 dp')
  })

  it('groups by section in display order', () => {
    const groups = groupFieldsBySection([
      field({ id: 'b', display_order: 2, section: 'Storage' }),
      field({ id: 'a', display_order: 1, section: 'Identity' }),
      field({ id: 'c', display_order: 3, section: 'Identity' }),
    ])

    expect(groups.map((g) => [g.name, g.fields.length])).toEqual([
      ['Identity', 2],
      ['Storage', 1],
    ])
  })

  it('diffs added and retired fields', () => {
    const before = definition([field({ id: 'a', label: 'Old' })])

    const after = definition([
      field({ id: 'a', label: 'Old', lifecycle: 'retired' }),
      field({ id: 'b', label: 'New' }),
    ])

    const changes = diffModelVersions(before, after)
    expect(changes.map((c) => `${c.kind} ${c.subject}`)).toEqual([
      'Removed Old',
      'Added New',
    ])
    expect(summariseChanges(changes, false, 2)).toContain('Added New')
    expect(summariseChanges([], true, 7)).toBe('Created with 7 fields')
  })

  it('keeps change identity stable across duplicate labels, multiple dimensions and reordered fields', () => {
    const before = definition([
      field({
        id: 'a',
        label: 'Shared',
        options: [
          {
            id: 'old-a',
            key: 'old',
            label: 'Same',
            displayOrder: 0,
            lifecycle: 'active',
          },
        ],
      }),
      field({
        id: 'b',
        label: 'Shared',
        options: [
          {
            id: 'old-b',
            key: 'old',
            label: 'Same',
            displayOrder: 0,
            lifecycle: 'active',
          },
        ],
      }),
    ])

    const after = definition(
      before.fields.map<ModelVersionField>((row) => ({
        ...row,
        label: 'Renamed',
        validation: { max: 30 },
        options: [
          {
            id: `new-${row.id}`,
            key: 'new',
            label: 'Same',
            displayOrder: 1,
            lifecycle: 'active',
          },
        ],
      })),
    )

    const changes = diffModelVersions(before, after)
    expect(changes.map((change) => change.id)).toEqual([
      'field:a:name',
      'field:a:rule',
      'field:a:option:old-a:removed',
      'field:a:option:new-a:added',
      'field:b:name',
      'field:b:rule',
      'field:b:option:old-b:removed',
      'field:b:option:new-b:added',
    ])
    expect(
      diffModelVersions(before, { fields: [...after.fields].reverse() })
        .map((change) => change.id)
        .sort(),
    ).toEqual(changes.map((change) => change.id).sort())
  })
})
