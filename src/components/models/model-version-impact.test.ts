import { describe, expect, it } from 'vitest'

import {
  buildVersionImpacts,
  classifyRecordOutcome,
  diffVersionFields,
} from './model-version-impact'
import type {
  CanonicalDatasetSchemaField,
  CanonicalDatasetSchemaVersion,
} from '#/lib/dataset-schema-definition-rpc'

function field(
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

function version(
  overrides: Partial<CanonicalDatasetSchemaVersion> = {},
): CanonicalDatasetSchemaVersion {
  return {
    id: 'v-1',
    schema_id: 'def-1',
    version: 1,
    revision: 1,
    lifecycle: 'active',
    published_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('diffVersionFields', () => {
  it('reports added, removed and changed fields with concrete detail', () => {
    const diff = diffVersionFields(
      [
        field('kept'),
        field('grown', { logical_type: 'decimal', nullable: false }),
        field('fresh', { label: 'Fresh' }),
      ],
      [field('kept'), field('grown'), field('gone', { label: 'Gone' })],
    )
    expect(diff.added.map((c) => c.key)).toEqual(['fresh'])
    expect(diff.removed.map((c) => c.key)).toEqual(['gone'])
    expect(diff.changed.map((c) => c.key)).toEqual(['grown'])
    expect(diff.changed[0].detail).toContain('type text → decimal')
    expect(diff.changed[0].detail).toContain('now required')
    expect(diff.total).toBe(3)
  })

  it('reports no change when the version matches its predecessor', () => {
    const diff = diffVersionFields([field('a')], [field('a')])
    expect(diff.total).toBe(0)
  })

  it('reports semantic-only edits and ignores JSON object key ordering', () => {
    const before = field('mass', {
      logical_type: 'decimal',
      quantity: { kind: 'mass', dimension: 'mass', storageUnit: 'mg' },
      validation: { min: 0, max: 10 },
      default_value: 0,
    })
    const after = {
      ...before,
      quantity: { storageUnit: 'g', dimension: 'mass', kind: 'mass' },
      validation: { min: 1, max: 10 },
      default_value: 2,
    }
    expect(diffVersionFields([after], [before]).changed[0].detail).toBe(
      'quantity / units changed · validation constraints changed · default value changed',
    )
    expect(
      diffVersionFields(
        [
          {
            ...before,
            quantity: { storageUnit: 'mg', dimension: 'mass', kind: 'mass' },
          },
        ],
        [before],
      ).total,
    ).toBe(0)
    const reference = field('sample', {
      logical_type: 'reference',
      relationship: {
        target: { kind: 'model', modelKey: 'sample' },
        cardinality: 'many',
      },
      cardinality: 'many',
    })
    expect(
      diffVersionFields(
        [
          {
            ...reference,
            relationship: {
              target: { kind: 'model', modelKey: 'reagent' },
              cardinality: 'many',
            },
          },
        ],
        [reference],
      ).changed[0].detail,
    ).toContain('reference target changed')
  })
})

describe('classifyRecordOutcome', () => {
  it('marks drafts unpublished and the latest publish new-records-only', () => {
    expect(classifyRecordOutcome(version({ lifecycle: 'draft' }), 4)).toBe(
      'draft',
    )
    expect(classifyRecordOutcome(version({ version: 4 }), 4)).toBe(
      'new-records-only',
    )
    expect(classifyRecordOutcome(version({ version: 3 }), 4)).toBe('unchanged')
  })
})

describe('buildVersionImpacts', () => {
  it('counts records per version and older records newest-first', () => {
    const fields = new Map([
      ['v-1', [field('a')]],
      ['v-2', [field('a'), field('b')]],
    ])
    const rows = buildVersionImpacts(
      [version({ id: 'v-2', version: 2 }), version({ id: 'v-1', version: 1 })],
      fields,
      [
        { schema_version_id: 'v-1' },
        { schema_version_id: 'v-1' },
        { schema_version_id: 'v-2' },
      ],
    )
    expect(rows.map((r) => r.version.version)).toEqual([2, 1])
    expect(rows[0].recordCount).toBe(1)
    expect(rows[0].olderRecordCount).toBe(2)
    expect(rows[0].outcome).toBe('new-records-only')
    expect(rows[0].diff.added.map((c) => c.key)).toEqual(['b'])
    expect(rows[1].recordCount).toBe(2)
    expect(rows[1].olderRecordCount).toBe(0)
    expect(rows[1].outcome).toBe('unchanged')
    expect(rows[1].diff.total).toBe(0)
  })
})
