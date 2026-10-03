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

/**
 * DSET-04.3 — true only for the one retention reason that can lose its rows.
 * A hand keep, a signed citation or an active Dataset is never prunable.
 */
export function isSnapshotPrunable(
  retention: DatasetVersionRetention | null | undefined,
): boolean {
  return retention?.reason === 'uncited_after_archive'
}

export interface SnapshotPruneWarning {
  versionId: string
  label: string
  /** ISO date the rows become eligible for removal, if reported. */
  dueAt: string | null
  /** True once the due date has passed and the rows are eligible now. */
  overdue: boolean
  /** Sentence naming the snapshot and its removal date. */
  title: string
  /** The "not cited…" consequence and the offered action. */
  detail: string
}

/**
 * DSET-04.3 — the warning a reviewer sees before retention removes rows. Null
 * for cited/kept/active snapshots and for snapshots already tombstoned. The
 * removal date comes from the read model's `keptUntil`, never a constant.
 */
export function describePruneWarning(
  version: Pick<
    SnapshotVersion,
    'id' | 'label' | 'retention' | 'rowsRemovedAt'
  >,
  now: Date = new Date(),
): SnapshotPruneWarning | null {
  if (version.rowsRemovedAt || !isSnapshotPrunable(version.retention))
    return null
  const dueAt = version.retention.keptUntil
  const overdue = dueAt ? new Date(dueAt).getTime() <= now.getTime() : false
  const title = overdue
    ? `${version.label} is overdue for row removal (was due ${formatDate(dueAt)}).`
    : `${version.label} is due for row removal on ${formatDate(dueAt)}.`
  return {
    versionId: version.id,
    label: version.label,
    dueAt,
    overdue,
    title,
    detail: 'It isn’t cited by a signed record. Keep it if you still need it.',
  }
}

/**
 * DSET-04.3 — the most urgent prunable snapshot, so the warning acts on the
 * one closest to losing its rows. Overdue snapshots sort before scheduled
 * ones; ties fall back to the earliest reported due date.
 */
export function mostUrgentPruneWarning(
  versions: readonly SnapshotVersion[],
  now: Date = new Date(),
): SnapshotPruneWarning | null {
  const warnings = versions
    .map((version) => describePruneWarning(version, now))
    .filter((warning): warning is SnapshotPruneWarning => warning !== null)
  if (warnings.length === 0) return null
  const dueTime = (warning: SnapshotPruneWarning) =>
    warning.dueAt ? new Date(warning.dueAt).getTime() : Number.POSITIVE_INFINITY
  warnings.sort((a, b) => dueTime(a) - dueTime(b))
  return warnings[0]
}

export interface SnapshotTombstoneView {
  label: 'Rows removed'
  tone: Tone
  /** ISO date the job removed the rows. */
  removedAt: string
  /** One-line identity/consequence statement. */
  detail: string
  /** The retention rule that applied, from the workspace policy. */
  rule: string
  /** Why the rows were removed, and what still resolves. */
  why: string
}

/** True once the retention job has removed this snapshot's rows. */
export function isSnapshotTombstone(
  version: Pick<SnapshotVersion, 'rowsRemovedAt'> | null | undefined,
): boolean {
  return Boolean(version?.rowsRemovedAt)
}

/**
 * DSET-04.3 — the tombstone view for a snapshot whose rows were removed. The
 * identity, hash and history remain; the frozen row data is gone. This is
 * built from `rowsRemovedAt` and the retention policy, so it never claims
 * rows still exist.
 */
export function describeSnapshotTombstone(
  version: Pick<SnapshotVersion, 'rowsRemovedAt' | 'retention'>,
): SnapshotTombstoneView {
  const removedAt = formatDate(version.rowsRemovedAt)
  const policy = version.retention.policy
  return {
    label: 'Rows removed',
    tone: 'stored',
    removedAt,
    detail: `Rows removed ${removedAt}. The snapshot’s ID and history are kept.`,
    rule: policy
      ? `Uncited, ${policy.uncitedYears} years after archive`
      : 'Uncited after archive',
    why: 'No signed record cited this snapshot, so the retention job removed its rows. Links and citations still open this page; the data itself is gone.',
  }
}

/**
 * DSET-04.3 — one truthful "keeping" view for a list row or the inspector. A
 * tombstoned snapshot reports rows removed rather than its now-past retention
 * schedule, so the UI never shows a prunable snapshot with no rows left.
 */
export function describeSnapshotKeeping(
  version: SnapshotVersion | null | undefined,
): SnapshotRetentionView | null {
  if (!version) return null
  if (isSnapshotTombstone(version)) {
    const tombstone = describeSnapshotTombstone(version)
    return {
      label: tombstone.label,
      tone: tombstone.tone,
      detail: tombstone.detail,
      policy: describeRetentionPolicy(version.retention),
    }
  }
  return describeSnapshotRetention(version.retention)
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
export function snapshotCompareTotalRows(counts: DatasetVersionChange): number {
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

/**
 * DSET-04.3 — friendly copy for a failed keep. The keep RPC requires a writer
 * and a reason; the client validates the reason, so this mainly translates
 * the server's permission refusal.
 */
export function describeKeepError(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'code' in cause) {
    const code = (cause as { code?: unknown }).code
    if (code === '42501')
      return 'You do not have permission to keep this snapshot, or it is not in the active workspace.'
    if (code === '22023')
      return 'Enter a reason between 1 and 500 characters to keep this snapshot.'
  }
  if (cause instanceof Error && cause.message) return cause.message
  return 'Please try again.'
}
