import { useQuery } from '@tanstack/react-query'

import { SignaturesTable } from '#/components/review/signatures-table'
import { Notice } from '#/components/v3/ui/alert'
import { InspectorSection, Muted } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  fetchRevisionDrift,
  revisionEvidenceQueryKeys,
} from '#/lib/revision-evidence'
import type { RevisionDrift } from '#/lib/revision-evidence'
import { fetchSignaturesForRecord, signatureQueryKeys } from '#/lib/signatures'
import { t } from '#/copy'

/**
 * The signatures that attest this revision. The signed record renders once, in
 * the page; who signed it, and when, sits beside it in the inspector.
 */
export function EvidenceSignatures({
  recordId,
  revisionId,
  structureVersion,
}: {
  recordId: string
  revisionId: string
  structureVersion?: number
}) {
  const signatures = useQuery({
    queryKey: signatureQueryKeys.forRecord(recordId),
    queryFn: () => fetchSignaturesForRecord(notebookDataClient, recordId),
    enabled: Boolean(recordId),
  })
  const mine = (signatures.data ?? []).filter(
    (s) => s.revision_id === revisionId,
  )
  return (
    <InspectorSection title={t('projects.evidence.signatures')}>
      <SignaturesTable
        signatures={mine}
        isLoading={signatures.isPending}
        isError={signatures.isError}
        revisionVersions={
          structureVersion === undefined
            ? undefined
            : { [revisionId]: structureVersion }
        }
      />
    </InspectorSection>
  )
}

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

/** What has moved since the revision was signed, from the drift read model. */
export function EvidenceDrift({
  revisionId,
  signed = true,
}: {
  revisionId: string
  /** Whether anyone has signed this revision; drift is measured from then. */
  signed?: boolean
}) {
  const drift = useQuery({
    queryKey: revisionEvidenceQueryKeys.drift(revisionId),
    queryFn: () => fetchRevisionDrift(notebookDataClient, revisionId),
  })
  return (
    <InspectorSection
      title={
        signed
          ? t('projects.evidence.drift.title')
          : t('projects.evidence.drift.titleSubmitted')
      }
    >
      {drift.isError ? (
        <Notice tone="warn">{t('projects.evidence.drift.failed')}</Notice>
      ) : drift.isPending ? (
        <Muted>{t('projects.evidence.drift.checking')}</Muted>
      ) : (
        <>
          <Status tone={drift.data.drifted ? 'warn' : 'ok'}>
            {drift.data.drifted
              ? t('projects.evidence.drift.moved')
              : signed
                ? t('projects.evidence.drift.matches')
                : t('projects.evidence.drift.matchesSubmitted')}
          </Status>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-label text-fg-muted">
            {driftSummary(drift.data).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
    </InspectorSection>
  )
}
