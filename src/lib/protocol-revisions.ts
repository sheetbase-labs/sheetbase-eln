/**
 * Taking a protocol from a draft to its effective version.
 *
 * A protocol's text is frozen into a version when a revision is submitted; the
 * version then goes through the approval chain (technical review, then QA) and
 * becomes the effective version, superseding the one before it. Each step is a
 * server RPC that checks role and independence again; these helpers only chain
 * them so a person does one thing at a time: submit, approve, done.
 */
import {
  approveApprovalRequest,
  submitApprovalRequest,
} from '#/lib/approval-requests'
import type { ApprovalRequest } from '#/lib/approval-requests'
import type { DataClient } from '#/lib/data-client'
import {
  PROTOCOL_REVISION_KIND,
  createProtocolVersion,
  setProtocolVersionStatus,
} from '#/lib/controlled-protocols'
import type { ProtocolVersion } from '#/lib/controlled-protocols'

/**
 * The chain the server insists on (`submit_approval_request` refuses any other
 * set): technical review by a scientist or steward, then QA by a reviewer,
 * admin or owner. Sorted as the server compares them.
 */
export const PROTOCOL_APPROVER_ROLES = [
  'admin',
  'owner',
  'reviewer',
  'scientist',
  'steward',
] as const

export const PROTOCOL_REQUIRED_APPROVALS = 2

/** Roles that give the technical sign-off, and the ones that give QA. */
export const TECHNICAL_REVIEW_ROLES = ['scientist', 'steward'] as const
export const QA_ROLES = ['reviewer', 'admin', 'owner'] as const

export interface SubmitRevisionInput {
  workspaceId: string
  protocolRecordId: string
  changeSummary: string
  /** Resume a version that was frozen but never reached review. */
  existingVersion?: Pick<ProtocolVersion, 'id' | 'status'>
}

/**
 * Freeze the protocol's current text as a new version, move it into review and
 * ask for the approval chain, in one go. A version that was frozen but never
 * submitted (a half-finished earlier attempt) is picked up instead of frozen
 * again, so retrying never leaves two drafts.
 */
export async function submitProtocolRevision(
  client: DataClient,
  input: SubmitRevisionInput,
): Promise<{ versionId: string; request: ApprovalRequest }> {
  const summary = input.changeSummary.trim()
  if (!summary) throw new Error('Say what changed in this version.')
  let versionId = input.existingVersion?.id
  let status = input.existingVersion?.status
  if (!versionId) {
    const version = await createProtocolVersion(client, {
      protocolRecordId: input.protocolRecordId,
      changeSummary: summary,
    })
    versionId = version.id
    status = version.status
  }
  if (status === 'draft') {
    await setProtocolVersionStatus(client, {
      protocolVersionId: versionId,
      status: 'in_review',
      reason: summary,
    })
  }
  const request = await submitApprovalRequest(client, {
    workspaceId: input.workspaceId,
    objectKind: PROTOCOL_REVISION_KIND,
    objectId: versionId,
    requiredApproverRoles: [...PROTOCOL_APPROVER_ROLES],
    reason: summary,
    requireIndependence: true,
    requiredApprovals: PROTOCOL_REQUIRED_APPROVALS,
  })
  return { versionId, request }
}

export interface ApproveRevisionResult {
  request: ApprovalRequest
  /** True when this approval completed the chain and the version took effect. */
  effective: boolean
  /** Why the version could not take effect after a complete approval. */
  releaseError?: string
}

/**
 * Record one approval. When it completes the chain the version becomes the
 * effective one straight away, so approving the last step is the release; if
 * the release itself is refused the approval still stands and the error says
 * why, so the version can be made effective from the Versions tab.
 */
export async function approveProtocolRevision(
  client: DataClient,
  input: { requestId: string; versionId: string; reason?: string },
): Promise<ApproveRevisionResult> {
  const request = await approveApprovalRequest(
    client,
    input.requestId,
    input.reason,
  )
  if (request.state !== 'approved') return { request, effective: false }
  try {
    await makeProtocolVersionEffective(client, input.versionId)
    return { request, effective: true }
  } catch (cause) {
    return {
      request,
      effective: false,
      releaseError:
        cause instanceof Error ? cause.message : 'The release was refused.',
    }
  }
}

/** Make an approved version the effective one; the previous one is superseded. */
export function makeProtocolVersionEffective(
  client: DataClient,
  versionId: string,
): Promise<ProtocolVersion> {
  return setProtocolVersionStatus(client, {
    protocolVersionId: versionId,
    status: 'effective',
    reason: 'Approved',
  })
}

/** Which step of the chain a request is waiting on. */
export type ChainStage = 'technical' | 'qa' | 'complete'

export function chainStage(
  decisions: readonly { decision: string; role: string }[],
  approved: boolean,
): ChainStage {
  if (approved) return 'complete'
  const technical = decisions.some(
    (d) =>
      d.decision === 'approved' &&
      (TECHNICAL_REVIEW_ROLES as readonly string[]).includes(d.role),
  )
  return technical ? 'qa' : 'technical'
}

/**
 * The roles that may act on the stage a request is waiting on. The server
 * refuses QA before technical review, so a QA approver is not offered the
 * button early.
 */
export function stageRoles(stage: ChainStage): readonly string[] {
  if (stage === 'technical') return TECHNICAL_REVIEW_ROLES
  if (stage === 'qa') return QA_ROLES
  return []
}
