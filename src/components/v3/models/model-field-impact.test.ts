import { describe, expect, it } from 'vitest'

import { buildModelFieldImpact } from './model-field-impact'
import type { ObjectDependency } from '#/lib/object-dependencies'

function dependency(kind: string): ObjectDependency {
  return {
    kind,
    id: `dep-${kind}`,
    relation: 'references',
    liveness: 'active',
    effect: 'requires_migration',
    label: kind,
  }
}

describe('buildModelFieldImpact', () => {
  it('orders versions newest first and counts records per version', () => {
    const impact = buildModelFieldImpact(
      [
        { id: 'v-1', version: 1 },
        { id: 'v-2', version: 2 },
      ],
      [
        { version_id: 'v-1', record_count: 2, migratable_record_count: 1 },
        { version_id: 'v-2', record_count: 5, migratable_record_count: 4 },
      ],
      [],
    )
    expect(impact.recordsOnEachVersion).toEqual([
      { versionId: 'v-2', version: 2, recordCount: 5 },
      { versionId: 'v-1', version: 1, recordCount: 2 },
    ])
    // A closed historical record is usage, but not a migration candidate.
    expect(impact.migratableRecords).toBe(1)
  })

  it('counts dependent templates and sheets, ignoring other kinds', () => {
    const impact = buildModelFieldImpact(
      [{ id: 'v-1', version: 1 }],
      [],
      [
        dependency('notebook_template_version'),
        dependency('sheet_definition_version'),
        dependency('sheet_instance'),
        dependency('record'),
      ],
    )
    expect(impact.templates).toBe(1)
    expect(impact.sheets).toBe(2)
    expect(impact.migratableRecords).toBe(0)
  })
})
