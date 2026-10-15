import type { NotebookTemplateVersion } from './notebook-template-data'

/**
 * R5-CONFIG-04: the in-use evidence over the records that are actually pinned
 * to a Notebook Template Version (`records.source_notebook_template_version_id`).
 *
 * Nothing here recomputes the pin: the version/governance records stay the
 * source of truth and these helpers only group and count the rows the surface
 * already reads. Kept free of React so the same derivation can be checked
 * against the database in `tests/db/notebook-template-in-use.test.ts`.
 */

/** The three buckets the Versions and In-use screens group records into. */
export type TemplateUseStatus = 'signed' | 'in-review' | 'in-progress'

export interface TemplateUsageRecord {
  id: string
  identifier: string
  title: string
  status: string
  locked_at: string | null
  project_id: string | null
  created_by_user_id: string | null
  created_at: string
  updated_at: string
  source_notebook_template_version_id: string | null
}

/**
 * Mirrors the record-status rule the In-use table uses: a lock (a record
 * signature) wins, then anything the workflow put in review, else in progress.
 */
export function templateUseStatus(record: {
  status: string
  locked_at: string | null
}): TemplateUseStatus {
  if (record.locked_at) return 'signed'
  if (record.status.toLowerCase().includes('review')) return 'in-review'
  return 'in-progress'
}

export interface TemplateUseCounts {
  total: number
  inProgress: number
  inReview: number
  signed: number
}

export function countTemplateUse<
  T extends { status: string; locked_at: string | null },
>(records: T[]): TemplateUseCounts {
  const counts: TemplateUseCounts = {
    total: 0,
    inProgress: 0,
    inReview: 0,
    signed: 0,
  }
  for (const record of records) {
    counts.total += 1
    switch (templateUseStatus(record)) {
      case 'signed':
        counts.signed += 1
        break
      case 'in-review':
        counts.inReview += 1
        break
      case 'in-progress':
        counts.inProgress += 1
        break
    }
  }
  return counts
}

export interface TemplateInUseMatrixRow extends TemplateUseCounts {
  version: NotebookTemplateVersion
}

/**
 * Records by version: one row per version of the template (newest first), even
 * when no record is on it, so an empty version is visible rather than implied.
 * Records pinning a version outside the list are not attributed to any row.
 */
export function buildInUseMatrix(
  records: TemplateUsageRecord[],
  versions: NotebookTemplateVersion[],
): TemplateInUseMatrixRow[] {
  const byVersion = new Map<string, TemplateUsageRecord[]>()
  for (const record of records) {
    const key = record.source_notebook_template_version_id
    if (!key) continue
    const bucket = byVersion.get(key) ?? []
    bucket.push(record)
    byVersion.set(key, bucket)
  }
  return [...versions]
    .sort((a, b) => b.version - a.version)
    .map((version) => ({
      version,
      ...countTemplateUse(byVersion.get(version.id) ?? []),
    }))
}

export interface InUseStaleness {
  /** Every record pinned to a version that is no longer the current one. */
  behind: number
  /** Of those, the ones an owner can move to the current version now. */
  updatable: number
  /** Of those, signed records that stay where they are. */
  stays: number
}

/**
 * Whether the in-use set is behind the current published version, and how much
 * of it can move. Signed records never change; records in review wait for the
 * review to finish before they can be updated.
 */
export function inUseStaleness(
  records: TemplateUsageRecord[],
  currentVersionId: string | undefined,
): InUseStaleness {
  let behind = 0
  let updatable = 0
  let stays = 0
  for (const record of records) {
    if (!currentVersionId) break
    if (record.source_notebook_template_version_id === currentVersionId)
      continue
    behind += 1
    if (record.locked_at) {
      stays += 1
      continue
    }
    if (!record.status.toLowerCase().includes('review')) updatable += 1
  }
  return { behind, updatable, stays }
}

export interface InUseFilters {
  versionId?: string
  projectId?: string
}

/** The project/version filter the URL carries; the parameter was parsed but
 * unused before R5-CONFIG-04. */
export function filterInUseRecords<T extends TemplateUsageRecord>(
  records: T[],
  filters: InUseFilters,
): T[] {
  return records.filter((record) => {
    if (
      filters.versionId &&
      record.source_notebook_template_version_id !== filters.versionId
    )
      return false
    if (filters.projectId && record.project_id !== filters.projectId)
      return false
    return true
  })
}
