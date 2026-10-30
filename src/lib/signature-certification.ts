import type { DataClient } from '#/lib/data-client'
import { createDataClient } from '#/lib/data-client'
import { requestSignatureStepUp } from '#/lib/signatures'
import { z } from 'zod'

/**
 * SIGN-003 — electronic signature certification. A person certifies their
 * signature per workspace; certifying again records the new statement version
 * and withdrawing revokes it. Writes go through the api RPCs so the user id and
 * membership are checked server-side.
 */
export const SIGNATURE_STATEMENT_VERSION = 1
export const SIGNATURE_STATEMENT =
  'I understand that my electronic signature in Sheetbase is the legally binding equivalent of my handwritten signature. I will not share my password, and I will report any suspected misuse to QA.'

/** The statement a person certifies, with the version it carries. */
export interface SignatureStatement {
  text: string
  version: number
  /** The workspace worded it; false is the standard statement. */
  custom: boolean
}

export const signatureStatementQueryKeys = {
  workspace: (workspaceId: string) =>
    ['ui-port', 'signature-statement', workspaceId] as const,
}

export async function fetchSignatureStatement(
  client: DataClient,
  workspaceId: string,
): Promise<SignatureStatement> {
  const rows = await client.list<{
    signature_statement: string | null
    signature_statement_version: number | null
  }>(
    'workspace_settings',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=signature_statement,signature_statement_version`,
  )
  const row = rows.at(0)
  return {
    text: row?.signature_statement?.trim() || SIGNATURE_STATEMENT,
    version: row?.signature_statement_version ?? SIGNATURE_STATEMENT_VERSION,
    custom: Boolean(row?.signature_statement?.trim()),
  }
}

export async function updateSignatureStatement(
  client: DataClient,
  workspaceId: string,
  statement: string,
): Promise<void> {
  await client.rpc('update_signature_statement', {
    p_workspace_id: workspaceId,
    p_statement: statement,
  })
}

export interface WorkspaceCertification {
  userId: string
  name: string
  statementVersion: number | null
  certifiedAt: string | null
  revokedAt: string | null
  identityVerifiedAt: string | null
  identityVerifiedBy: string | null
  verifiedEmail: string | null
  verificationRequested: boolean
  authMethod: string | null
  /** The workspace's statement version at the time of the read. */
  currentStatementVersion?: number
}

interface CertificationWire {
  user_id: string
  name: string
  statement_version: number | null
  certified_at: string | null
  revoked_at: string | null
  identity_verified_at: string | null
  identity_verified_by: string | null
  verified_email: string | null
  verification_requested: boolean
  auth_method: string | null
  current_statement_version?: number | null
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
    identityVerifiedAt: r.identity_verified_at,
    identityVerifiedBy: r.identity_verified_by,
    verifiedEmail: r.verified_email,
    verificationRequested: r.verification_requested,
    authMethod: r.auth_method,
    currentStatementVersion:
      r.current_statement_version ?? SIGNATURE_STATEMENT_VERSION,
  }))
}

export function isCertified(
  certification: WorkspaceCertification | undefined,
): boolean {
  return Boolean(
    certification?.certifiedAt &&
    certification.identityVerifiedAt &&
    (certification.authMethod === 'password' ||
      certification.authMethod === 'demo') &&
    !certification.revokedAt,
  )
}

export function isCurrentStatement(
  certification: WorkspaceCertification | undefined,
): boolean {
  return (
    certification?.statementVersion ===
      (certification?.currentStatementVersion ?? SIGNATURE_STATEMENT_VERSION) &&
    isCertified(certification)
  )
}

export async function certifySignature(
  client: DataClient,
  workspaceId: string,
  password: string,
  statementVersion: number = SIGNATURE_STATEMENT_VERSION,
): Promise<void> {
  const proof = await requestSignatureStepUp({
    workspaceId,
    purpose: 'certify',
    password,
  })
  await client.rpc('certify_signature', {
    p_workspace_id: workspaceId,
    p_statement_version: statementVersion,
    p_signing_token: proof.token,
  })
}

export async function practiceSignature(
  client: DataClient,
  workspaceId: string,
  password: string,
): Promise<void> {
  const proof = await requestSignatureStepUp({
    workspaceId,
    purpose: 'practice',
    password,
  })
  await client.rpc('practice_signature', { p_signing_token: proof.token })
}

export async function requestIdentityVerification(
  client: DataClient,
): Promise<void> {
  await client.rpc('request_signature_identity_verification', {})
}

/** The signer confirms their own identity; only an unregulated lab allows it. */
export async function selfVerifySignatureIdentity(
  client: DataClient,
  ownEmail: string,
): Promise<void> {
  await client.rpc('self_verify_signature_identity', { p_email: ownEmail })
}

export async function verifySignatureIdentity(
  client: DataClient,
  userId: string,
  independentlyVerifiedEmail: string,
): Promise<void> {
  await client.rpc('verify_signature_identity', {
    p_user_id: userId,
    p_email: independentlyVerifiedEmail,
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
  reauth: 'every'
}

/** Defaults match app-3: Authored is always on; password at every signature. */
export function readSignaturePolicy(policy: unknown): SignaturePolicy {
  const parsed = z
    .object({
      meanings: z
        .object({
          Witnessed: z.boolean().optional(),
          Reviewed: z.boolean().optional(),
          Approved: z.boolean().optional(),
        })
        .optional(),
    })
    .safeParse(policy)
  const meanings = parsed.success ? parsed.data.meanings : undefined
  return {
    meanings: {
      Authored: true,
      Witnessed: meanings?.Witnessed !== false,
      Reviewed: meanings?.Reviewed !== false,
      Approved: meanings?.Approved !== false,
    },
    reauth: 'every',
  }
}
