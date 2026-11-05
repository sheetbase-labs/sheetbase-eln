import type {
  CanonicalDatasetSchemaField,
  CanonicalDatasetSchemaVersion,
} from '#/lib/dataset-schema-definition-rpc'
import { stableJson } from '#/lib/dataset-schema-draft'

/**
 * MDL-02 step 4 — the Versions tab read model. Pure so it can be tested
 * without a client. Field changes are diffed between a version and its
 * immediate predecessor; record impact counts the datasets (records) pinned to
 * each version from the canonical datasets read.
 *
 * The dataset schema registry stores no per-version migration outcome and no
 * reason-for-change, so this module never invents one: it classifies the
 * publish outcome from the pinning invariant (publishing forks a new version
 * and never rewrites existing datasets) and reports the concrete field-contract
 * difference as the closest truthful substitute for a stored reason.
 */

export type VersionChangeKind = 'added' | 'removed' | 'changed'

export interface FieldChange {
  kind: VersionChangeKind
  key: string
  label: string
  /** Concrete property difference, e.g. "type text → decimal". Null when the
   * change is purely an add/remove with nothing to describe. */
  detail: string | null
}

export interface VersionFieldDiff {
  added: FieldChange[]
  removed: FieldChange[]
  changed: FieldChange[]
  total: number
}

const EMPTY_DIFF: VersionFieldDiff = {
  added: [],
  removed: [],
  changed: [],
  total: 0,
}

function describeChange(
  before: CanonicalDatasetSchemaField,
  after: CanonicalDatasetSchemaField,
): string | null {
  const parts: string[] = []
  if (before.logical_type !== after.logical_type)
    parts.push(`type ${before.logical_type} → ${after.logical_type}`)
  if (before.nullable !== after.nullable)
    parts.push(after.nullable ? 'now optional' : 'now required')
  if (before.cardinality !== after.cardinality)
    parts.push(`cardinality ${before.cardinality} → ${after.cardinality}`)
  if (before.lifecycle !== after.lifecycle)
    parts.push(after.lifecycle === 'retired' ? 'retired' : 'reactivated')
  if (before.label !== after.label) parts.push(`renamed from “${before.label}”`)
  if (before.description !== after.description)
    parts.push('description changed')
  for (const [property, label] of [
    ['quantity', 'quantity / units'],
    ['validation', 'validation constraints'],
    ['category', 'category options'],
    ['relationship', 'reference target'],
    ['default_value', 'default value'],
  ] as const) {
    const fallback = property === 'validation' ? {} : null
    if (
      stableJson(before[property] ?? fallback) !==
      stableJson(after[property] ?? fallback)
    )
      parts.push(`${label} changed`)
  }
  return parts.length ? parts.join(' · ') : null
}

/** Diff a version's fields against its predecessor, matched by stable key. */
export function diffVersionFields(
  current: CanonicalDatasetSchemaField[],
  previous: CanonicalDatasetSchemaField[],
): VersionFieldDiff {
  const previousByKey = new Map(previous.map((f) => [f.key, f]))
  const currentKeys = new Set(current.map((f) => f.key))
  const added: FieldChange[] = []
  const changed: FieldChange[] = []
  for (const field of current) {
    const before = previousByKey.get(field.key)
    if (!before) {
      added.push({
        kind: 'added',
        key: field.key,
        label: field.label,
        detail: null,
      })
      continue
    }
    const detail = describeChange(before, field)
    if (detail)
      changed.push({
        kind: 'changed',
        key: field.key,
        label: field.label,
        detail,
      })
  }
  const removed: FieldChange[] = previous
    .filter((f) => !currentKeys.has(f.key))
    .map((f) => ({
      kind: 'removed',
      key: f.key,
      label: f.label,
      detail: null,
    }))
  return {
    added,
    removed,
    changed,
    total: added.length + removed.length + changed.length,
  }
}

export type RecordOutcome = 'draft' | 'new-records-only' | 'unchanged'

export interface VersionRecordImpact {
  version: CanonicalDatasetSchemaVersion
  diff: VersionFieldDiff
  /** Datasets (records) pinned to this version. */
  recordCount: number
  /** Datasets pinned to strictly older versions; unchanged when this published. */
  olderRecordCount: number
  outcome: RecordOutcome
}

/** The registry marks a published version `active`/`retired`; only `draft` is
 * unpublished. */
export function isPublishedVersion(
  version: CanonicalDatasetSchemaVersion,
): boolean {
  return version.lifecycle !== 'draft'
}

export function classifyRecordOutcome(
  version: CanonicalDatasetSchemaVersion,
  latestPublishedVersion: number | null,
): RecordOutcome {
  if (!isPublishedVersion(version)) return 'draft'
  if (
    latestPublishedVersion !== null &&
    version.version === latestPublishedVersion
  )
    return 'new-records-only'
  return 'unchanged'
}

/**
 * Build the per-version rows newest-first. `fieldsByVersion` is keyed by
 * version id; `datasets` carries the canonical `schema_version_id` pins.
 */
export function buildVersionImpacts(
  versions: CanonicalDatasetSchemaVersion[],
  fieldsByVersion: Map<string, CanonicalDatasetSchemaField[]>,
  datasets: { schema_version_id: string }[],
): VersionRecordImpact[] {
  const ascending = [...versions].sort((a, b) => a.version - b.version)
  const latestPublishedVersion =
    ascending.filter(isPublishedVersion).at(-1)?.version ?? null
  const counts = new Map<string, number>()
  for (const dataset of datasets)
    counts.set(
      dataset.schema_version_id,
      (counts.get(dataset.schema_version_id) ?? 0) + 1,
    )
  let olderRunning = 0
  const rows = ascending.map((version, index) => {
    const previous = index > 0 ? ascending[index - 1] : null
    const diff = previous
      ? diffVersionFields(
          fieldsByVersion.get(version.id) ?? [],
          fieldsByVersion.get(previous.id) ?? [],
        )
      : EMPTY_DIFF
    const recordCount = counts.get(version.id) ?? 0
    const row: VersionRecordImpact = {
      version,
      diff,
      recordCount,
      olderRecordCount: olderRunning,
      outcome: classifyRecordOutcome(version, latestPublishedVersion),
    }
    olderRunning += recordCount
    return row
  })
  return rows.reverse()
}
