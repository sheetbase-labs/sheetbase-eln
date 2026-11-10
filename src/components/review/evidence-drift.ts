import type { RevisionDrift } from '#/lib/revision-evidence'
import { t } from '#/copy'

/** What a drift read says, in words a reader can act on. */
export function driftSummary(drift: RevisionDrift): string[] {
  const lines: string[] = []

  if (drift.record.renamed)
    lines.push(
      t('projects.evidence.drift.recordRenamed', {
        from: drift.record.signedTitle ?? '—',
        to: drift.record.currentTitle,
      }),
    )

  for (const instrument of drift.instruments)
    if (instrument.renamed)
      lines.push(
        t('projects.evidence.drift.instrumentRenamed', {
          from: instrument.signedName ?? '—',
          to: instrument.currentName ?? '—',
        }),
      )

  for (const dataset of drift.datasets)
    if (dataset.changed)
      lines.push(
        t('projects.evidence.drift.datasetNewer', {
          cited: dataset.citedLabel ?? t('projects.evidence.drift.cited'),
          latest: dataset.latestLabel ?? t('projects.evidence.drift.latest'),
        }),
      )

  if (drift.commentsAfterSigning > 0)
    lines.push(
      t('projects.evidence.drift.commentsAfter', {
        count: drift.commentsAfterSigning,
      }),
    )

  return lines
}
