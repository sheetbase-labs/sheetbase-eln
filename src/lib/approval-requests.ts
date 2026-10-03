/**
 * MDL-03.1 — reusable approval requests (client boundary).
 *
 * `api.approval_requests` is generic: `object_kind` names the governed object
 * (Dataset Schema Version today; parsers, protocols and promotions later) and
 * `object_id` is its immutable identity. Every mutation is a server RPC; the
 * browser only reads requests through RLS. Types use the PostgREST snake_case
 * wire shape.
 */
import type { DataClient } from './data-client'

export type ApprovalRequestState =
  'pending' | 'approved' | 'returned' | 'withdrawn'

/** Dataset Schema Version is the first governed object kind (MDL-03.2). */
export const DATASET_SCHEMA_VERSION_KIND = 'dataset_schema_version'

export interface ApprovalRequest {
  id: string
  workspace_id: string
  object_kind: string
  object_id: string
  object_revision: number | null
  required_approver_roles: string[]
  required_approvals: number
  require_independence: boolean
  state: ApprovalRequestState
  reason: string | null
  decision_reason: string | null
  approved_by_user_ids: string[]
  submitted_by_user_id: string | null
  submitted_at: string
  decided_by_user_id: string | null
  decided_at: string | null
  created_at: string
  updated_at: string
}

export interface SubmitApprovalRequestInput {
  workspaceId: string
  objectKind: string
  objectId: string
  requiredApproverRoles: string[]
  reason: string
  requireIndependence?: boolean
  requiredApprovals?: number
  objectRevision?: number | null
}

export function submitApprovalRequest(
  client: DataClient,
  input: SubmitApprovalRequestInput,
): Promise<ApprovalRequest> {
  return client.rpc('submit_approval_request', {
    p_workspace_id: input.workspaceId,
    p_object_kind: input.objectKind,
    p_object_id: input.objectId,
    p_required_approver_roles: input.requiredApproverRoles,
    p_reason: input.reason,
    p_require_independence: input.requireIndependence ?? true,
    p_required_approvals: input.requiredApprovals ?? 1,
    p_object_revision: input.objectRevision ?? null,
  })
}

export function withdrawApprovalRequest(
  client: DataClient,
  requestId: string,
  reason?: string,
): Promise<ApprovalRequest> {
  return client.rpc('withdraw_approval_request', {
    p_request_id: requestId,
    p_reason: reason ?? null,
  })
}

export function approveApprovalRequest(
  client: DataClient,
  requestId: string,
  reason?: string,
): Promise<ApprovalRequest> {
  return client.rpc('approve_approval_request', {
    p_request_id: requestId,
    p_reason: reason ?? null,
  })
}

export function returnApprovalRequest(
  client: DataClient,
  requestId: string,
  reason: string,
): Promise<ApprovalRequest> {
  return client.rpc('return_approval_request', {
    p_request_id: requestId,
    p_reason: reason,
  })
}

export function listApprovalRequests(
  client: DataClient,
  objectKind: string,
  objectId: string,
): Promise<ApprovalRequest[]> {
  return client.list(
    'approval_requests',
    `?object_kind=eq.${objectKind}&object_id=eq.${objectId}` +
      '&select=id,workspace_id,object_kind,object_id,object_revision,' +
      'required_approver_roles,required_approvals,require_independence,state,' +
      'reason,decision_reason,approved_by_user_ids,submitted_by_user_id,' +
      'submitted_at,decided_by_user_id,decided_at,created_at,updated_at' +
      '&order=created_at.desc',
  )
}
