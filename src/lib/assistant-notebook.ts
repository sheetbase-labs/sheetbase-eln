import { z } from 'zod'

/**
 * Notebook work from the assistant: comments, files, protocols and approval
 * requests. Reads answer in the reply; writes are cards. As with the other
 * cards, the model names things the way people do, the server finds them and
 * sends back a card, and nothing happens until the person presses the button,
 * which calls the ordinary RPC as them. Signing, approving or returning an
 * approval request, acknowledging a protocol for yourself and deleting a file
 * stay with people and have no tool here.
 */

export const COMMENTS_READ_TOOL = 'sheetbase.comments.read'
export const PROTOCOLS_READ_TOOL = 'sheetbase.protocols.read'
export const FILES_READ_TOOL = 'sheetbase.files.read'
export const APPROVALS_READ_TOOL = 'sheetbase.approvals.read'

export const NOTEBOOK_READ_TOOL_NAMES = [
  COMMENTS_READ_TOOL,
  PROTOCOLS_READ_TOOL,
  FILES_READ_TOOL,
  APPROVALS_READ_TOOL,
] as const

export const COMMENT_ADD_TOOL = 'sheetbase.comment.add'
export const COMMENT_REPLY_TOOL = 'sheetbase.comment.reply'
export const COMMENT_RESOLVE_TOOL = 'sheetbase.comment.resolve'
export const FILE_QUARANTINE_TOOL = 'sheetbase.file.quarantine'
export const FILE_RESTORE_TOOL = 'sheetbase.file.restore'
export const FILE_DELETE_TOOL = 'sheetbase.file.delete'
export const PROTOCOL_NEW_VERSION_TOOL = 'sheetbase.protocol.new_version'
export const PROTOCOL_SET_STATUS_TOOL = 'sheetbase.protocol.set_status'

export const PROTOCOL_CONFIRM_CURRENT_TOOL =
  'sheetbase.protocol.confirm_current'

export const PROTOCOL_ASSIGN_TRAINING_TOOL =
  'sheetbase.protocol.assign_training'

export const PROTOCOL_UNASSIGN_TRAINING_TOOL =
  'sheetbase.protocol.unassign_training'

export const PROTOCOL_RECORD_TRAINED_TOOL = 'sheetbase.protocol.record_trained'

export const PROTOCOL_DEVIATION_REASON_TOOL =
  'sheetbase.protocol.deviation_reason'

export const APPROVAL_REQUEST_TOOL = 'sheetbase.approval.request'
export const APPROVAL_WITHDRAW_TOOL = 'sheetbase.approval.withdraw'

export const NOTEBOOK_PROPOSE_TOOL_NAMES = [
  COMMENT_ADD_TOOL,
  COMMENT_REPLY_TOOL,
  COMMENT_RESOLVE_TOOL,
  FILE_QUARANTINE_TOOL,
  FILE_RESTORE_TOOL,
  FILE_DELETE_TOOL,
  PROTOCOL_NEW_VERSION_TOOL,
  PROTOCOL_SET_STATUS_TOOL,
  PROTOCOL_CONFIRM_CURRENT_TOOL,
  PROTOCOL_ASSIGN_TRAINING_TOOL,
  PROTOCOL_UNASSIGN_TRAINING_TOOL,
  PROTOCOL_RECORD_TRAINED_TOOL,
  PROTOCOL_DEVIATION_REASON_TOOL,
  APPROVAL_REQUEST_TOOL,
  APPROVAL_WITHDRAW_TOOL,
] as const

export type NotebookProposeToolName =
  (typeof NOTEBOOK_PROPOSE_TOOL_NAMES)[number]

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)
const named = (what: string) => z.string().min(1).max(200).describe(what)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
const record = named('The notebook by identifier (EXP-12) or title.')
const protocol = named('The protocol by identifier or title.')
const person = named('The person, by name.')

export const commentsReadSchema = z.strictObject({
  record,
  openOnly: z
    .boolean()
    .optional()
    .describe('Only comments in threads that are still open.'),
})

export const protocolsReadSchema = z.strictObject({
  protocol: protocol
    .optional()
    .describe(
      'One protocol by identifier or title. Leave out to list the protocols with their current version.',
    ),
})

export const filesReadSchema = z.strictObject({
  name: named('Words from the file name.').optional(),
  contains: named(
    'Words inside the files, such as a search of their text.',
  ).optional(),
})

export const approvalsReadSchema = z.strictObject({
  state: z
    .enum(['pending', 'approved', 'returned', 'withdrawn'])
    .optional()
    .describe('Default pending.'),
})

export const proposeCommentAddSchema = z.strictObject({
  title,
  summary,
  record,
  body: z
    .string()
    .min(1)
    .max(4000)
    .describe('The comment, in the person’s words.'),
  mentions: z
    .array(person)
    .max(10)
    .optional()
    .describe('People to tell, by name.'),
})

export const proposeCommentReplySchema = z.strictObject({
  title,
  summary,
  record,
  thread: named('Words from the comment being replied to.'),
  body: z.string().min(1).max(4000),
  mentions: z.array(person).max(10).optional(),
})

export const proposeCommentResolveSchema = z.strictObject({
  title,
  summary,
  record,
  thread: named('Words from a comment in the thread.'),
  reopen: z
    .boolean()
    .optional()
    .describe('true to open a resolved thread again.'),
})

export const proposeFileStatusSchema = z.strictObject({
  title,
  summary,
  file: named('The file, by words from its name.'),
  reason: z
    .string()
    .min(1)
    .max(300)
    .optional()
    .describe('Why it is being quarantined or deleted.'),
})

export const proposeProtocolNewVersionSchema = z.strictObject({
  title,
  summary,
  protocol,
  changeSummary: z.string().min(1).max(500).describe('What changed.'),
  reason: z.string().min(1).max(500).optional(),
})

export const proposeProtocolSetStatusSchema = z.strictObject({
  title,
  summary,
  protocol,
  version: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('The version number. Leave out for the newest.'),
  status: z.enum(['draft', 'in_review', 'effective', 'superseded', 'retired']),
  reason: z.string().min(1).max(500).optional(),
})

export const proposeProtocolConfirmCurrentSchema = z.strictObject({
  title,
  summary,
  protocol,
  version: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('The version number. Leave out for the newest.'),
  nextReviewDueAt: day
    .optional()
    .describe('When it is next due for review (YYYY-MM-DD).'),
  reason: z.string().min(1).max(500).optional(),
})

export const proposeProtocolAssignTrainingSchema = z.strictObject({
  title,
  summary,
  protocol,
  person,
  dueOn: day.optional().describe('When it is due, YYYY-MM-DD.'),
  notes: z.string().min(1).max(500).optional(),
})

export const proposeProtocolUnassignTrainingSchema = z.strictObject({
  title,
  summary,
  protocol,
  person,
})

export const proposeProtocolRecordTrainedSchema = z.strictObject({
  title,
  summary,
  protocol,
  person,
  version: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('The version trained on. Leave out for the one in effect.'),
  notes: z.string().min(1).max(500).optional(),
})

export const proposeProtocolDeviationReasonSchema = z.strictObject({
  title,
  summary,
  record,
  step: named('Words from the step that was done differently.').optional(),
  reason: z.string().min(1).max(2000).describe('Why it was done differently.'),
})

export const proposeApprovalRequestSchema = z.strictObject({
  title,
  summary,
  objectKind: z
    .string()
    .min(1)
    .max(60)
    .describe('What is to be approved, such as `dataset_schema_version`.'),
  objectId: z.string().uuid().describe('Its id, from an earlier answer.'),
  roles: z
    .array(z.string().min(1).max(40))
    .min(1)
    .max(8)
    .describe('Roles that may approve, such as reviewer or admin.'),
  reason: z.string().min(1).max(500),
  approvals: z.number().int().min(1).max(5).optional(),
})

export const proposeApprovalWithdrawSchema = z.strictObject({
  title,
  summary,
  request: z
    .string()
    .uuid()
    .optional()
    .describe('The request id. Leave out when the person has one waiting.'),
  reason: z.string().min(1).max(500).optional(),
})

/** What a notebook card does when its button is pressed. */
export type NotebookAction =
  | {
      kind: 'notebook.comment_add'
      recordId: string
      body: string
      mentions: string[]
    }
  | {
      kind: 'notebook.comment_reply'
      commentId: string
      body: string
      mentions: string[]
    }
  | { kind: 'notebook.comment_resolve'; commentId: string; reopen: boolean }
  | {
      kind: 'notebook.file_status'
      fileId: string
      expectedVersion: number
      status: 'quarantine' | 'restore' | 'delete'
      reason: string | null
    }
  | {
      kind: 'notebook.protocol_new_version'
      protocolRecordId: string
      changeSummary: string
      reason: string | null
    }
  | {
      kind: 'notebook.protocol_set_status'
      versionId: string
      status: 'draft' | 'in_review' | 'effective' | 'superseded' | 'retired'
      reason: string | null
    }
  | {
      kind: 'notebook.protocol_confirm_current'
      versionId: string
      nextReviewDueAt: string | null
      reason: string | null
    }
  | {
      kind: 'notebook.protocol_assign_training'
      protocolRecordId: string
      userId: string
      dueAt: string | null
      notes: string | null
    }
  | {
      kind: 'notebook.protocol_unassign_training'
      protocolRecordId: string
      userId: string
    }
  | {
      kind: 'notebook.protocol_record_trained'
      versionId: string
      userId: string
      notes: string | null
    }
  | { kind: 'notebook.deviation_reason'; deviationId: string; reason: string }
  | {
      kind: 'notebook.approval_request'
      workspaceId: string
      objectKind: string
      objectId: string
      roles: string[]
      reason: string
      approvals: number
    }
  | {
      kind: 'notebook.approval_withdraw'
      requestId: string
      reason: string | null
    }

export type NotebookActionKind = NotebookAction['kind']

export function isNotebookAction(action: {
  kind: string
}): action is NotebookAction {
  return action.kind.startsWith('notebook.')
}

export interface NotebookActionResult {
  openHref?: string
}
