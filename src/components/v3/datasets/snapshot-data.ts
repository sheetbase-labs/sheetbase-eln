/**
 * DSET-03.1 — truthful presentation helpers for the dataset Snapshots tab.
 *
 * The read model (`api.dataset_version_list`) now returns the real retention
 * state, the producer and the citations. These pure helpers turn that wire
 * data into labels, tones and copy so the UI never hardcodes "Kept" or a
 * policy the workspace did not set.
 */
import type {
  DatasetVersionChange,
  DatasetVersionCitations,
  DatasetVersionRetention,
  DatasetVersionSource,
  DatasetVersionSummary,
} from '#/lib/dataset-explorer-data'
import type { Tone } from '#/components/v3/ui/status'

export type SnapshotVersion = DatasetVersionSummary

export interface SnapshotRetentionView {
  label: string
  tone: Tone
  detail: string
  policy: string
}

function formatDate(value: string | null): string {
  return value ? value.slice(0, 10) : '—'
}

/** Human-readable summary of the workspace retention policy, if reported. */
export function describeRetentionPolicy(
  retention: DatasetVersionRetention | null | undefined,
): string {
  const policy = retention?.policy
  if (!policy) {
    return 'Workspace retention policy was not reported for this snapshot.'
  }
  return `Snapshots cited by a signed record are kept for ${policy.citedYears} years; uncited snapshots lose their rows ${policy.uncitedYears} years after the dataset is archived.`
}

/**
 * Turn the retention reason into a truthful label, tone and explanation.
 * `active`, `kept` and `cited_by_signed_record` are safe; only
 * `uncited_after_archive` is prunable.
 */
export function describeSnapshotRetention(
  retention: DatasetVersionRetention | null | undefined,
): SnapshotRetentionView {
  const policy = describeRetentionPolicy(retention)
  const keptUntil = formatDate(retention?.keptUntil ?? null)
  switch (retention?.reason) {
    case 'cited_by_signed_record':
      return {
        label: 'Kept',
        tone: 'ok',
        detail: `Cited by a signed record; retained until ${keptUntil}.`,
        policy,
      }
    case 'kept':
      return {
        label: 'Kept',
        tone: 'ok',
        detail: `Kept by hand until ${keptUntil}.`,
        policy,
      }
    case 'uncited_after_archive':
      return {
        label: 'Prunable',
        tone: 'warn',
        detail: `Uncited after archive; its rows are eligible for removal after ${keptUntil}.`,
        policy,
      }
    case 'active':
      return {
        label: 'Active',
        tone: 'stored',
        detail: 'The dataset is active; no removal is scheduled.',
        policy,
      }
    default:
      return {
        label: 'Unknown',
        tone: 'none',
        detail: 'Retention state was not reported for this snapshot.',
        policy,
      }
  }
}

/** Describe the producer of a snapshot from the read model. */
export function describeSnapshotSource(
  source: DatasetVersionSource | null | undefined,
): string {
  if (!source) return '—'
  if (source.kind === 'pipeline_run') {
    const bits = [source.definitionName ?? 'Pipeline run']
    if (source.triggerKind) bits.push(source.triggerKind)
    if (source.status) bits.push(source.status)
    if (source.label) bits.push(source.label)
    return bits.join(' · ')
  }
  if (source.kind === 'api') return 'Saved through the API'
  return 'Saved by hand'
}

export interface SnapshotCitationCounts {
  signedRevisions: number
  pipelineRuns: number
  analyses: number
}

export function countSnapshotCitations(
  citedBy: DatasetVersionCitations | null | undefined,
): SnapshotCitationCounts {
  return {
    signedRevisions: citedBy?.signedRevisions.length ?? 0,
    pipelineRuns: citedBy?.pipelineRuns.length ?? 0,
    analyses: citedBy?.analyses.length ?? 0,
  }
}

/** True when anything cites the snapshot; drives the inspector copy. */
export function hasSnapshotCitations(
  citedBy: DatasetVersionCitations | null | undefined,
): boolean {
  const counts = countSnapshotCitations(citedBy)
  return (
    counts.signedRevisions > 0 || counts.pipelineRuns > 0 || counts.analyses > 0
  )
}

/**
 * Individual citations for the inspector. Each line names what cites the
 * snapshot, so the count summary is not the only evidence shown. Ids are
 * shortened for the narrow inspector; the record/run/revision remains
 * traceable through its own surface.
 */
export function describeSnapshotCitations(
  citedBy: DatasetVersionCitations | null | undefined,
): string[] {
  const lines: string[] = []
  for (const revision of citedBy?.signedRevisions ?? []) {
    lines.push(
      `Signed record ${revision.revisionId.slice(0, 8)} · ${revision.signedAt.slice(0, 10)}`,
    )
  }
  for (const run of citedBy?.pipelineRuns ?? []) {
    lines.push(`Pipeline run ${run.runId.slice(0, 8)} · ${run.status}`)
  }
  for (const analysis of citedBy?.analyses ?? []) {
    lines.push(`Analysis in ${analysis.recordId.slice(0, 8)}`)
  }
  return lines
}

/** One page of a comparison, as returned by `compare_dataset_versions`. */
export interface SnapshotComparePage {
  counts: DatasetVersionChange
  offset: number
  limit: number
  rows: unknown[]
}

/** Total changed rows the server counted across the whole comparison. */
export function snapshotCompareTotalRows(
  counts: DatasetVersionChange,
): number {
  return counts.added + counts.removed + counts.changed
}

/**
 * DSET-03.3 — true while the loaded compare pages do not yet cover every
 * changed row. The server reports whole-comparison counts on every page, so
 * paging is driven by the response rather than a fixed window.
 */
export function hasMoreSnapshotCompareRows(page: SnapshotComparePage): boolean {
  return page.offset + page.rows.length < snapshotCompareTotalRows(page.counts)
}

/**
 * Friendly copy for a failed snapshot save. The RPC stays authoritative; this
 * only translates its known codes so the toast explains what happened.
 */
export function describeSnapshotError(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'code' in cause) {
    const code = (cause as { code?: unknown }).code
    if (code === 'SB001')
      return 'This dataset changed elsewhere. Refresh and try again.'
    if (code === '42501')
      return 'You do not have permission to snapshot this dataset.'
    if (code === '22023') return 'Archived datasets cannot be snapshotted.'
  }
  if (cause instanceof Error && cause.message) return cause.message
  return 'Please try again.'
}
