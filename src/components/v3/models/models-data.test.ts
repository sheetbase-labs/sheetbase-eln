import { describe, expect, it } from 'vitest'

import { buildModelRows, modelStatus } from './models-data'
import type {
  CanonicalDatasetSchemaDefinition,
  CanonicalDatasetSchemaVersion,
} from '#/lib/dataset-schema-definition-rpc'

function definition(
  overrides: Partial<CanonicalDatasetSchemaDefinition> = {},
): CanonicalDatasetSchemaDefinition {
  return {
    id: 'def-1',
    key: 'osmolality',
    name: 'Osmolality reading',
    description: null,
    lifecycle: 'active',
    display_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    created_by_user_id: null,
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
    lifecycle: 'draft',
    published_at: null,
    ...overrides,
  }
}

describe('buildModelRows', () => {
  it('attaches versions, latest version and per-latest counts', () => {
    const rows = buildModelRows(
      [definition()],
      [
        version({ id: 'v-1', version: 1, lifecycle: 'published' }),
        version({ id: 'v-2', version: 2, lifecycle: 'draft' }),
      ],
      [
        { schema_version_id: 'v-2' },
        { schema_version_id: 'v-2' },
        { schema_version_id: 'v-1' },
      ],
      [{ schema_version_id: 'v-2' }, { schema_version_id: 'v-2' }],
    )

    expect(rows).toHaveLength(1)
    // The latest version is chosen by version number, not input order.
    expect(rows[0].latestVersion?.id).toBe('v-2')
    expect(rows[0].versions.map((v) => v.version)).toEqual([2, 1])
    expect(rows[0].fieldCount).toBe(2)
    expect(rows[0].datasetCount).toBe(2)
  })

  it('reports zero counts for a definition with no version', () => {
    const rows = buildModelRows([definition()], [], [], [])
    expect(rows[0].latestVersion).toBeNull()
    expect(rows[0].fieldCount).toBe(0)
    expect(rows[0].datasetCount).toBe(0)
  })
})

describe('modelStatus', () => {
  it('maps lifecycle to tone and label', () => {
    expect(modelStatus('active')).toEqual({ tone: 'ok', label: 'Active' })
    expect(modelStatus('draft')).toEqual({ tone: 'draft', label: 'Draft' })
    expect(modelStatus('retired')).toEqual({
      tone: 'stored',
      label: 'Retired',
    })
  })

  it('falls back to a title-cased label for unknown lifecycles', () => {
    expect(modelStatus('under_review')).toEqual({
      tone: 'none',
      label: 'Under review',
    })
  })
})
