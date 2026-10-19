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
    <InspectorSection title="Signatures">
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
      `Record renamed: ${drift.record.signedTitle ?? '—'} → ${drift.record.currentTitle}`,
    )
  for (const instrument of drift.instruments)
    if (instrument.renamed)
      lines.push(
        `Instrument renamed: ${instrument.signedName ?? '—'} → ${instrument.currentName ?? '—'}`,
      )
  for (const dataset of drift.datasets)
    if (dataset.changed)
      lines.push(
        `Dataset has a newer version than the one cited (${dataset.citedLabel ?? 'cited'} → ${dataset.latestLabel ?? 'latest'})`,
      )
  if (drift.commentsAfterSigning > 0)
    lines.push(
      `${drift.commentsAfterSigning} comment${drift.commentsAfterSigning === 1 ? '' : 's'} added after signing`,
    )
  return lines
}

/** What has moved since the revision was signed, from the drift read model. */
export function EvidenceDrift({ revisionId }: { revisionId: string }) {
  const drift = useQuery({
    queryKey: revisionEvidenceQueryKeys.drift(revisionId),
    queryFn: () => fetchRevisionDrift(notebookDataClient, revisionId),
  })
  return (
    <InspectorSection title="Drift since signing">
      {drift.isError ? (
        <Notice tone="warn">
          Drift could not be read, so this page cannot say whether anything has
          moved since signing.
        </Notice>
      ) : drift.isPending ? (
        <Muted>Checking what has moved…</Muted>
      ) : (
        <>
          <Status tone={drift.data.drifted ? 'warn' : 'ok'}>
            {drift.data.drifted ? 'Moved since signing' : 'Matches signing'}
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
