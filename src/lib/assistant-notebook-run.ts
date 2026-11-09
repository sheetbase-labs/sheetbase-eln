import {
  submitApprovalRequest,
  withdrawApprovalRequest,
} from './approval-requests'
import {
  createRecordComment,
  reopenCommentThread,
  replyToComment,
  resolveCommentThread,
} from './comments-data'
import {
  assignProtocolTraining,
  createProtocolVersion,
  recordProtocolTrained,
  setProtocolVersionStatus,
  unassignProtocolTraining,
} from './controlled-protocols'
import type { DataClient } from './data-client'
import { recordDeviationReason } from './protocol-deviations'
import type { NotebookAction, NotebookActionResult } from './assistant-notebook'

/** Runs a notebook card's action. Loaded only in the browser, when a button is pressed. */
export async function runNotebookAction(
  client: DataClient,
  action: NotebookAction,
): Promise<NotebookActionResult | undefined> {
  switch (action.kind) {
    case 'notebook.comment_add':
      await createRecordComment(client, {
        recordId: action.recordId,
        body: action.body,
        mentions: action.mentions,
      })
      return { openHref: `/records/${action.recordId}` }
    case 'notebook.comment_reply':
      await replyToComment(
        client,
        action.commentId,
        action.body,
        action.mentions,
      )
      return
    case 'notebook.comment_resolve':
      if (action.reopen) await reopenCommentThread(client, action.commentId)
      else await resolveCommentThread(client, action.commentId)
      return
    case 'notebook.file_status':
      await client.rpc(
        action.status === 'quarantine'
          ? 'quarantine_file'
          : action.status === 'delete'
            ? 'delete_file'
            : 'restore_file',
        action.status === 'restore'
          ? {
              p_file_id: action.fileId,
              p_expected_version: action.expectedVersion,
            }
          : {
              p_file_id: action.fileId,
              p_expected_version: action.expectedVersion,
              p_reason: action.reason,
            },
      )
      return
    case 'notebook.protocol_new_version':
      await createProtocolVersion(client, {
        protocolRecordId: action.protocolRecordId,
        changeSummary: action.changeSummary,
        reason: action.reason,
      })
      return { openHref: `/records/${action.protocolRecordId}` }
    case 'notebook.protocol_set_status':
      await setProtocolVersionStatus(client, {
        protocolVersionId: action.versionId,
        status: action.status as 'in_review' | 'effective' | 'retired',
        reason: action.reason ?? '',
      })
      return
    case 'notebook.protocol_confirm_current':
      await client.rpc('confirm_protocol_version_current', {
        p_version_id: action.versionId,
        p_next_review_due_at: action.nextReviewDueAt,
        p_reason: action.reason,
      })
      return
    case 'notebook.protocol_assign_training':
      await assignProtocolTraining(client, {
        protocolRecordId: action.protocolRecordId,
        userId: action.userId,
        dueAt: action.dueAt,
        notes: action.notes ?? undefined,
      })
      return
    case 'notebook.protocol_unassign_training':
      await unassignProtocolTraining(client, {
        protocolRecordId: action.protocolRecordId,
        userId: action.userId,
      })
      return
    case 'notebook.protocol_record_trained':
      await recordProtocolTrained(client, {
        versionId: action.versionId,
        userId: action.userId,
        notes: action.notes ?? undefined,
      })
      return
    case 'notebook.deviation_reason':
      await recordDeviationReason(client, action.deviationId, action.reason)
      return
    case 'notebook.approval_request':
      await submitApprovalRequest(client, {
        workspaceId: action.workspaceId,
        objectKind: action.objectKind,
        objectId: action.objectId,
        requiredApproverRoles: action.roles,
        reason: action.reason,
        requiredApprovals: action.approvals,
      })
      return
    case 'notebook.approval_withdraw':
      await withdrawApprovalRequest(
        client,
        action.requestId,
        action.reason ?? undefined,
      )
      return
  }
}
