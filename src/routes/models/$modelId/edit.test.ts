import { describe, expect, it } from 'vitest'

import { computeChanges } from './edit'
import type { CanonicalDatasetSchemaField } from '#/lib/dataset-schema-definition-rpc'

function published(
  key: string,
  overrides: Partial<CanonicalDatasetSchemaField> = {},
): CanonicalDatasetSchemaField {
  return {
    field_id: `f-${key}`,
    key,
    label: key,
    description: null,
    logical_type: 'text',
    nullable: true,
    cardinality: 'one',
    lifecycle: 'active',
    display_order: 1,
    ...overrides,
  }
}

describe('computeChanges', () => {
  it('detects added, changed and removed fields', () => {
    const changes = computeChanges(
      [
        { key: 'vials', label: 'Vials', logicalType: 'number' },
        { key: 'new_one', label: 'New one', logicalType: 'text' },
      ],
      [published('vials'), published('gone', { label: 'Gone' })],
    )
    expect(changes.byKey.get('vials')).toBe('Changed')
    expect(changes.byKey.get('new_one')).toBe('Added')
    expect(changes.removed.map((f) => f.key)).toEqual(['gone'])
    expect(changes.total).toBe(3)
  })

  it('reports no changes when the draft matches the published version', () => {
    const changes = computeChanges(
      [{ key: 'a', label: 'a', logicalType: 'text' }],
      [published('a')],
    )
    expect(changes.total).toBe(0)
  })
})
