/**
 * REV-04.2 — the evidence view's data.
 *
 * A signed revision is frozen, so the page shows two things: the package the server
 * exports (the canonical snapshot, its cited evidence and its integrity digest), and
 * what has moved since — the drift read model (REV-04.1). Neither is reconstructed
 * client-side.
 */
import type { DataClient } from './data-client'

export interface RevisionDrift {
  revisionId: string
  recordId: string
  signedAt: string
  record: {
    recordId: string
    identifier: string
    signedTitle: string | null
    currentTitle: string
    renamed: boolean
  }
  datasets: Array<{
    datasetId: string
    citedVersionId: string
    citedLabel: string | null
    latestVersionId: string | null
    latestLabel: string | null
    changed: boolean
  }>
  commentsAfterSigning: number
  drifted: boolean
}

export interface RevisionEvidencePackage {
  revision?: {
    id?: string
    integrityDigest?: string | null
    reason?: string | null
    createdAt?: string
  }
  files?: unknown[]
  comments?: unknown[]
  decisions?: unknown[]
  checkResults?: unknown[]
  datasetVersions?: unknown[]
  [key: string]: unknown
}

export const revisionEvidenceQueryKeys = {
  drift: (revisionId: string) =>
    ['ui-port', 'revision-drift', revisionId] as const,
  package: (revisionId: string) =>
    ['ui-port', 'revision-evidence-package', revisionId] as const,
}

export async function fetchRevisionDrift(
  client: DataClient,
  revisionId: string,
): Promise<RevisionDrift> {
  return client.rpc<RevisionDrift>('revision_drift', {
    p_revision_id: revisionId,
  })
}

export async function fetchRevisionEvidencePackage(
  client: DataClient,
  revisionId: string,
): Promise<RevisionEvidencePackage> {
  return client.rpc<RevisionEvidencePackage>('revision_evidence_package', {
    p_revision_id: revisionId,
  })
}
