import type { ObjectDependency } from '#/lib/object-dependencies'

/**
 * MDL-02.3 — what a field change would touch, shown to the steward *before*
 * it is applied. The three lines the design asks for: records on each version,
 * open experiments (the records "also migrate" would move), and templates.
 *
 * Pure, so the editor's impact panel is provable without a live registry.
 */
export interface VersionRecordCount {
  versionId: string
  version: number
  /** Records pinned to this version. */
  recordCount: number
}

export interface ModelFieldImpact {
  /** Records pinned per version, newest first. */
  recordsOnEachVersion: VersionRecordCount[]
  /**
   * Records pinned to a version other than the latest — what "also migrate
   * open experiments" would upgrade. A definition-only change touches none.
   */
  migratableRecords: number
  /** Dependent Notebook Template versions declaring a record parameter. */
  templates: number
  /** Dependent Sheet definition versions and instances bound to the model. */
  sheets: number
}

export function buildModelFieldImpact(
  versions: { id: string; version: number }[],
  usage: {
    version_id: string
    record_count: number
    migratable_record_count?: number
  }[],
  dependencies: ObjectDependency[],
): ModelFieldImpact {
  const recordsOnEachVersion = [...versions]
    .sort((a, b) => b.version - a.version)
    .map((version) => ({
      versionId: version.id,
      version: version.version,
      recordCount:
        usage.find((row) => row.version_id === version.id)?.record_count ?? 0,
    }))
  // Newest first: everything after the head is pinned to an earlier version.
  const migratableRecords = recordsOnEachVersion
    .slice(1)
    .reduce(
      (total, row) =>
        total +
        (usage.find((item) => item.version_id === row.versionId)
          ?.migratable_record_count ?? 0),
      0,
    )
  return {
    recordsOnEachVersion,
    migratableRecords,
    templates: dependencies.filter(
      (item) => item.kind === 'notebook_template_version',
    ).length,
    sheets: dependencies.filter(
      (item) =>
        item.kind === 'sheet_definition_version' ||
        item.kind === 'sheet_instance',
    ).length,
  }
}
