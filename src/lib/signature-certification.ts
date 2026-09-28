import type { DataClient } from '#/lib/data-client'
import { createDataClient } from '#/lib/data-client'
import { ASSURANCE_LEVEL_STATEMENT } from '#/lib/signatures'

/**
 * SIGN-003 — electronic signature certification. A person certifies their
 * signature per workspace; certifying again records the new statement version
 * and withdrawing revokes it. Writes go through the api RPCs so the user id and
 * membership are checked server-side.
 */
export const SIGNATURE_STATEMENT_VERSION = 1
export const SIGNATURE_STATEMENT = ASSURANCE_LEVEL_STATEMENT.standard

export interface WorkspaceCertification {
  userId: string
  name: string
  statementVersion: number | null
  certifiedAt: string | null
  revokedAt: string | null
}

interface CertificationWire {
  user_id: string
  name: string
  statement_version: number | null
  certified_at: string | null
  revoked_at: string | null
}

export const signatureCertificationDataClient = createDataClient()

export const signatureCertificationQueryKeys = {
  workspace: (workspaceId: string) =>
    ['ui-port', 'signature-certifications', workspaceId] as const,
}

export async function fetchWorkspaceCertifications(
  client: DataClient,
  _workspaceId: string,
): Promise<WorkspaceCertification[]> {
  const rows = await client.rpc<CertificationWire[]>(
    'workspace_signature_certifications',
    {},
  )
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    statementVersion: r.statement_version,
    certifiedAt: r.certified_at,
    revokedAt: r.revoked_at,
  }))
}

export function isCertified(
  certification: WorkspaceCertification | undefined,
): boolean {
  return Boolean(certification?.certifiedAt && !certification.revokedAt)
}

export function isCurrentStatement(
  certification: WorkspaceCertification | undefined,
): boolean {
  return (
    certification?.statementVersion === SIGNATURE_STATEMENT_VERSION &&
    !certification.revokedAt
  )
}

export async function certifySignature(
  client: DataClient,
  workspaceId: string,
  statementVersion: number = SIGNATURE_STATEMENT_VERSION,
): Promise<void> {
  await client.rpc('certify_signature', {
    p_workspace_id: workspaceId,
    p_statement_version: statementVersion,
  })
}

export async function withdrawSignatureCertification(
  client: DataClient,
  workspaceId: string,
): Promise<void> {
  await client.rpc('withdraw_signature_certification', {
    p_workspace_id: workspaceId,
  })
}

export interface SignaturePolicy {
  meanings: Record<string, boolean>
  reauth: 'every' | 'batch'
}

/** Defaults match app-3: Authored is always on; password at every signature. */
export function readSignaturePolicy(policy: unknown): SignaturePolicy {
  const value =
    policy && typeof policy === 'object'
      ? (policy as Record<string, unknown>)
      : {}
  const meanings =
    value.meanings && typeof value.meanings === 'object'
      ? (value.meanings as Record<string, boolean>)
      : {}
  return {
    meanings: {
      Authored: true,
      Reviewed: meanings.Reviewed !== false,
      Approved: meanings.Approved !== false,
    },
    reauth: value.reauth === 'batch' ? 'batch' : 'every',
  }
}
