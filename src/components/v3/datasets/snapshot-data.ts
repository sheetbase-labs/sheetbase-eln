/**
 * DSET-03.1 — truthful presentation helpers for the dataset Snapshots tab.
 *
 * The read model (`api.dataset_version_list`) now returns the real retention
 * state, the producer and the citations. These pure helpers turn that wire
 * data into labels, tones and copy so the UI never hardcodes "Kept" or a
 * policy the workspace did not set.
 */
import type {
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
