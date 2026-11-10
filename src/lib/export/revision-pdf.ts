/**
 * Internal PDF export of a signed revision.
 *
 * The bytes are rendered from the same server evidence package the ZIP export
 * uses (`revision_evidence_package`), never from live reads, so the PDF is the
 * revision as it was signed: its frozen blocks, a page of signatures with the
 * revision's integrity digest, and the verification code derived from it. It
 * reuses the portal PDF renderer so the two documents cannot drift apart.
 */
import { z } from 'zod'

import type { ClientPortalRecordDocument } from '#/lib/client-portal'
import { renderClientPortalRecordPdf } from '#/lib/client-portal-pdf'

interface PackageSignature {
  id?: unknown
  revision_id?: unknown
  signed_at?: unknown
  signature_meaning?: unknown
  revision_integrity_digest?: unknown
  signer_name?: unknown
  auth_method?: unknown
}

export interface RevisionPdfPackage {
  revision: {
    id: string
    structureVersion: number | string
    integrityDigest: string | null
  }
  record?: {
    identifier: string | null
    title: string | null
    kind: string | null
    status: string | null
  } | null
  blockSnapshot: unknown
  signatures: unknown[]
}

const signatureText = z.string().catch('')

/** A short code a reader can quote to check the document against the audit trail. */
export function verificationCodeFor(digest: string | null): string | null {
  if (!digest) return null
  const hex = digest.replace(/[^0-9a-f]/gi, '').toUpperCase()

  if (hex.length < 12) return null

  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`
}

/** The evidence package as the document the renderer draws. */
export function revisionPackageToDocument(
  pkg: RevisionPdfPackage,
): ClientPortalRecordDocument {
  // Legacy projection reads each original signature, including null failures.
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion
  const signatures = (pkg.signatures as PackageSignature[]).map((s) => ({
    id: signatureText.parse(s.id),
    revisionId: signatureText.parse(s.revision_id) || pkg.revision.id,
    // Preserve repeated native getter reads on string-valued signer names.
    // oxlint-disable-next-line anti-slop/no-runtime-typeof
    signerName: typeof s.signer_name === 'string' ? s.signer_name : null,
    signedAt: signatureText.parse(s.signed_at),
    signatureMeaning: signatureText.parse(s.signature_meaning),
    authMethod: signatureText.parse(s.auth_method),
    integrityDigest:
      signatureText.parse(s.revision_integrity_digest) ||
      (pkg.revision.integrityDigest ?? ''),
  }))

  const last = signatures.at(-1)
  const structure = Number(pkg.revision.structureVersion)

  return {
    recordId: pkg.revision.id,
    identifier: pkg.record?.identifier ?? pkg.revision.id,
    title: pkg.record?.title ?? 'Signed revision',
    kind: pkg.record?.kind ?? 'record',
    projectTitle: '',
    approvedAt: last?.signedAt ?? null,
    approvedByName: last?.signerName ?? null,
    signatureMeaning: last?.signatureMeaning ?? null,
    integrityDigest: pkg.revision.integrityDigest,
    verificationCode: verificationCodeFor(pkg.revision.integrityDigest),
    revisionStructureVersion: Number.isFinite(structure) ? structure : null,
    revisionId: pkg.revision.id,
    blockSnapshot: pkg.blockSnapshot,
    signatures,
    reportSections: [],
  }
}

export async function renderRevisionPdf(
  pkg: RevisionPdfPackage,
  options: { logo?: { bytes: Uint8Array; mediaType: string } | null } = {},
): Promise<Uint8Array> {
  return renderClientPortalRecordPdf(revisionPackageToDocument(pkg), options)
}
