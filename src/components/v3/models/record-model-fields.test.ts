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

function field(over: Record<string, unknown>): ModelVersionField {
  return {
    id: 'f1',
    field_name: 'vials',
    label: 'Vials',
    logical_type: 'integer',
    nullable: false,
    display_order: 0,
    lifecycle: 'active',
    validation: {},
    ...over,
  } as unknown as ModelVersionField
}

function definition(fields: ModelVersionField[]) {
  return { fields }
}

describe('record model field helpers', () => {
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
})
