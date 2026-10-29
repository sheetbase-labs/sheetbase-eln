/**
 * Whether the audit trail and the signed records were last found intact, and
 * when. The server checks once a day and administrators can check on demand;
 * both write the result `api.audit_verification_status` reads back for every
 * member of the workspace.
 */
import type { DataClient } from '#/lib/data-client'

export interface AuditVerificationStatus {
  ok: boolean
  checkedAt: string
  entriesChecked: number
  signaturesChecked: number
  firstBadRevisionId: string | null
}

export const auditVerificationKeys = {
  status: ['audit-verification'] as const,
}

/** `null` until the first check has run. */
export async function fetchAuditVerificationStatus(
  client: Pick<DataClient, 'rpc'>,
): Promise<AuditVerificationStatus | null> {
  return (
    (await client.rpc<AuditVerificationStatus | null>(
      'audit_verification_status',
      {},
    )) ?? null
  )
}

export async function runAuditVerificationNow(
  client: Pick<DataClient, 'rpc'>,
  workspaceId: string,
): Promise<void> {
  await client.rpc('run_audit_verification', { p_workspace_id: workspaceId })
}
