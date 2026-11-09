/**
 * Notebook work: comments, files, protocols and approval requests. One
 * declaration each gives the token API entry, the MCP action, the assistant
 * tool name, the pipeline action and the webhook events (see
 * `docs/development/adding-an-operation.md`).
 *
 * Signing, approving and deciding stay with a person in the app, so there is
 * nothing here for them: a reader acknowledging a protocol, a reviewer
 * confirming a review, approving or returning an approval request, and deleting
 * a file are not operations.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'

const MENTIONS = 'People to notify, as user ids.'

export const NOTEBOOK_OPERATIONS = defineOperations([
  // -- Comments -------------------------------------------------------------
  {
    name: 'create_record_comment',
    label: 'Comment on a notebook',
    summary: 'Comment on a notebook',
    description:
      'Starts a comment thread on a notebook or on one block of it. `p_target_kind` is `record` or `block` and `p_target` names the block. Returns the comment.',
    kind: 'write',
    inputs: [
      input('p_record_id', 'uuid'),
      input('p_target_kind', 'text'),
      input('p_target', 'json'),
      input('p_body', 'text'),
      { ...input('p_mentions', 'text[]', false), description: MENTIONS },
    ],
    assistant: { tool: 'sheetbase.comment.add' },
    pipeline: {},
    events: [
      {
        name: 'comment.created',
        family: 'record',
        summary: 'A comment or a reply was added.',
        producer: { entityType: 'comment', operation: 'create' },
        notes:
          'Payload carries commentId, threadRootId, parentId, revisionId and sheetInstanceId. It fires however the comment was made.',
      },
    ],
  },
  {
    name: 'create_sheet_comment',
    label: 'Comment on a sheet',
    summary: 'Comment on a sheet',
    description:
      'Starts a comment thread on a sheet or on a cell, row or column of it. Returns the comment.',
    kind: 'write',
    inputs: [
      input('p_instance_id', 'uuid'),
      input('p_expected_instance_revision', 'bigint'),
      input('p_target_kind', 'text'),
      input('p_target', 'json'),
      input('p_body', 'text'),
      { ...input('p_mentions', 'text[]', false), description: MENTIONS },
    ],
  },
  {
    name: 'create_comment',
    label: 'Comment on a submitted revision',
    summary: 'Comment on a submitted revision',
    description:
      'Starts a comment thread on a revision that was submitted for review. Returns the comment.',
    kind: 'write',
    inputs: [
      input('p_revision_id', 'uuid'),
      input('p_target_kind', 'text'),
      input('p_target', 'json'),
      input('p_body', 'text'),
      { ...input('p_mentions', 'text[]', false), description: MENTIONS },
    ],
  },
  {
    name: 'reply_to_comment',
    label: 'Reply to a comment',
    summary: 'Reply to a comment',
    description: 'Adds a reply to a comment thread. Returns the reply.',
    kind: 'write',
    inputs: [
      input('p_parent_id', 'uuid'),
      input('p_body', 'text'),
      { ...input('p_mentions', 'text[]', false), description: MENTIONS },
    ],
    assistant: { tool: 'sheetbase.comment.reply' },
    pipeline: {},
  },
  {
    name: 'resolve_comment_thread',
    label: 'Resolve a comment thread',
    summary: 'Resolve a comment thread',
    description: 'Marks a comment thread as resolved. Returns the thread.',
    kind: 'write',
    inputs: [input('p_comment_id', 'uuid')],
    assistant: { tool: 'sheetbase.comment.resolve' },
    pipeline: {},
    events: [
      {
        name: 'comment.resolved',
        family: 'record',
        summary: 'A comment thread was resolved.',
        producer: { entityType: 'comment', operation: 'resolve' },
      },
    ],
  },
  {
    name: 'reopen_comment_thread',
    label: 'Reopen a comment thread',
    summary: 'Reopen a comment thread',
    description: 'Opens a resolved comment thread again. Returns the thread.',
    kind: 'write',
    inputs: [input('p_comment_id', 'uuid')],
    pipeline: {},
    events: [
      {
        name: 'comment.reopened',
        family: 'record',
        summary: 'A resolved comment thread was opened again.',
        producer: { entityType: 'comment', operation: 'reopen' },
      },
    ],
  },
  {
    name: 'record_comments',
    label: 'List the comments on a notebook',
    summary: 'List the comments on a notebook',
    description:
      'Every comment on a notebook, in order, with who wrote it and whether its thread is resolved.',
    kind: 'read',
    inputs: [input('p_record_id', 'uuid')],
    result: 'row:comments',
  },
  {
    name: 'search_comments',
    label: 'Search comments',
    summary: 'Search comments',
    description:
      'Finds comments by the words in them, best match first. Only comments on notebooks the person can see.',
    kind: 'read',
    inputs: [
      input('p_query', 'text'),
      {
        ...input('p_limit', 'int', false),
        description: 'Most to return (default 20).',
      },
    ],
    result:
      'rows:comment_id=uuid,record_id=uuid,identifier=text,target_kind=text,anchor=json,body=text,author_user_id=text,created_at=ts,rank=num',
  },

  // -- Files ----------------------------------------------------------------
  {
    name: 'search_file_contents',
    label: 'Search inside files',
    summary: 'Search inside files',
    description:
      'Finds words inside uploaded text, PDF and Office files, with the line they are on. Only files the person can see.',
    kind: 'read',
    inputs: [
      input('p_query', 'text'),
      {
        ...input('p_limit', 'int', false),
        description: 'Most to return (default 20).',
      },
    ],
    result:
      'rows:file_id=uuid,record_id=uuid,identifier=text,display_name=text,line_number=int,line_text=text,snippet=text,rank=num',
  },
  {
    name: 'file_version_chain',
    label: 'List the versions of a file',
    summary: 'List the versions of a file',
    description:
      'Every version of a file, newest first, with its name, size and checksum. Download one with `GET /api/files/{recordId}/download?version=N`.',
    kind: 'read',
    inputs: [input('p_file_id', 'uuid')],
    result:
      'rows:id=uuid,version=int,display_name=text,media_type=text,byte_size=bigint,checksum=text,storage_key=text,created_at=ts,retention_until=ts,current=bool',
  },
  {
    name: 'quarantine_file',
    label: 'Quarantine a file',
    summary: 'Quarantine a file',
    description:
      'Takes a file out of use, for example after a virus warning. A quarantined file cannot be downloaded until it is restored. Returns the file.',
    kind: 'write',
    inputs: [
      input('p_file_id', 'uuid'),
      {
        ...input('p_expected_version', 'int'),
        description: 'The file version you last saw.',
      },
      {
        ...input('p_reason', 'text', false),
        description: 'Why, in a sentence.',
      },
    ],
    result: 'row:file_objects',
    assistant: { tool: 'sheetbase.file.quarantine' },
    pipeline: {},
    events: [
      {
        name: 'file.quarantined',
        family: 'record',
        summary: 'A file was quarantined.',
        producer: { entityType: 'file', operation: 'quarantine' },
      },
    ],
  },
  {
    name: 'restore_file',
    label: 'Restore a file',
    summary: 'Restore a file',
    description: 'Brings a quarantined file back into use. Returns the file.',
    kind: 'write',
    inputs: [
      input('p_file_id', 'uuid'),
      {
        ...input('p_expected_version', 'int'),
        description: 'The file version you last saw.',
      },
    ],
    result: 'row:file_objects',
    assistant: { tool: 'sheetbase.file.restore' },
    pipeline: {},
    events: [
      {
        name: 'file.restored',
        family: 'record',
        summary: 'A quarantined or deleted file was restored.',
        producer: { entityType: 'file', operation: 'restore' },
      },
    ],
  },

  {
    name: 'delete_file',
    label: 'Delete a file',
    summary: 'Delete a file',
    description:
      'Marks a file deleted. The bytes are kept for the retention period and a deleted file can be restored. Returns the file.',
    kind: 'write',
    inputs: [
      input('p_file_id', 'uuid'),
      {
        ...input('p_expected_version', 'int'),
        description: 'The file version you last saw.',
      },
      {
        ...input('p_reason', 'text', false),
        description: 'Why, in a sentence.',
      },
    ],
    result: 'row:file_objects',
    assistant: { tool: 'sheetbase.file.delete' },
    pipeline: {},
  },

  // -- Protocols ------------------------------------------------------------
  {
    name: 'create_protocol_version',
    label: 'Start a new protocol version',
    summary: 'Start a new protocol version',
    description:
      'Freezes the protocol as it is now into a new draft version, with a summary of what changed. Returns the version.',
    kind: 'write',
    inputs: [
      input('p_protocol_record_id', 'uuid'),
      input('p_change_summary', 'text'),
      { ...input('p_reason', 'text', false), description: 'Why it changed.' },
    ],
    result: 'row:protocol_versions',
    assistant: { tool: 'sheetbase.protocol.new_version' },
    pipeline: {},
    events: [
      {
        name: 'protocol.version.created',
        family: 'compliance',
        summary: 'A new version of a protocol was started.',
        producer: { entityType: 'protocol_version', operation: 'create' },
        notes: 'Payload carries protocolRecordId and version.',
      },
    ],
  },
  {
    name: 'set_protocol_version_status',
    label: 'Change a protocol version’s status',
    summary: 'Change a protocol version’s status',
    description:
      'Moves a version between `draft`, `in_review`, `effective`, `superseded` and `retired`. A version cannot become effective until its approvals are in; the database refuses it. Returns the version.',
    kind: 'write',
    inputs: [
      input('p_version_id', 'uuid'),
      input('p_status', 'text'),
      {
        ...input('p_reason', 'text', false),
        description: 'Why, in a sentence.',
      },
      {
        ...input('p_effective_at', 'ts', false),
        description: 'When it takes effect (default now).',
      },
    ],
    result: 'row:protocol_versions',
    assistant: { tool: 'sheetbase.protocol.set_status' },
    pipeline: {},
    events: [
      {
        name: 'protocol.version.updated',
        family: 'compliance',
        summary: 'A protocol version changed status or was confirmed current.',
        producer: { entityType: 'protocol_version', operation: 'update' },
        notes:
          'Payload carries protocolRecordId and status, or effect `confirmed_current` with the next review date.',
      },
    ],
  },
  {
    name: 'confirm_protocol_version_current',
    label: 'Confirm a protocol version is still current',
    summary: 'Confirm a protocol version is still current',
    description:
      'Records that an effective version was reviewed and is still right, and when the next review is due. Needs the right to edit schemas. Returns the version.',
    kind: 'write',
    inputs: [
      input('p_version_id', 'uuid'),
      {
        ...input('p_next_review_due_at', 'ts', false),
        description: 'When it is next due for review.',
      },
      {
        ...input('p_reason', 'text', false),
        description: 'Why, in a sentence.',
      },
    ],
    result: 'row:protocol_versions',
    assistant: { tool: 'sheetbase.protocol.confirm_current' },
    pipeline: {},
  },
  {
    name: 'assign_protocol_training',
    label: 'Give someone a protocol to train on',
    summary: 'Give someone a protocol to train on',
    description:
      'Asks a person to be trained on a protocol, with an optional due date. Returns the assignment.',
    kind: 'write',
    inputs: [
      input('p_protocol_record_id', 'uuid'),
      {
        ...input('p_user_id', 'text'),
        description: 'The person, as a user id.',
      },
      { ...input('p_due_at', 'ts', false), description: 'When it is due.' },
      input('p_notes', 'text', false),
    ],
    result: 'row:protocol_training',
    assistant: { tool: 'sheetbase.protocol.assign_training' },
    pipeline: {},
    events: [
      {
        name: 'protocol.training.assigned',
        family: 'compliance',
        summary: 'Someone was given a protocol to train on.',
        producer: { entityType: 'protocol_training', operation: 'create' },
        notes: 'Payload carries protocolRecordId, userId and dueAt.',
      },
    ],
  },
  {
    name: 'unassign_protocol_training',
    label: 'Take someone off a protocol’s training',
    summary: 'Take someone off a protocol’s training',
    description: 'Removes a person from a protocol’s training list.',
    kind: 'write',
    inputs: [
      input('p_protocol_record_id', 'uuid'),
      {
        ...input('p_user_id', 'text'),
        description: 'The person, as a user id.',
      },
    ],
    result: 'void',
    assistant: { tool: 'sheetbase.protocol.unassign_training' },
    pipeline: {},
    events: [
      {
        name: 'protocol.training.removed',
        family: 'compliance',
        summary: 'Someone was taken off a protocol’s training.',
        producer: { entityType: 'protocol_training', operation: 'delete' },
      },
    ],
  },
  {
    name: 'record_protocol_trained',
    label: 'Record someone as trained on a protocol',
    summary: 'Record someone as trained on a protocol',
    description:
      'Records that a person was trained on a version of a protocol, by the person who trained them. Returns the record.',
    kind: 'write',
    inputs: [
      input('p_version_id', 'uuid'),
      {
        ...input('p_user_id', 'text'),
        description: 'The person trained, as a user id.',
      },
      input('p_notes', 'text', false),
    ],
    result: 'row:protocol_acknowledgements',
    assistant: { tool: 'sheetbase.protocol.record_trained' },
    pipeline: {},
    events: [
      {
        name: 'protocol.acknowledged',
        family: 'compliance',
        summary:
          'Someone was recorded as trained on, or as having read, a protocol version.',
        producer: {
          entityType: 'protocol_acknowledgement',
          operation: 'create',
        },
        notes:
          'Payload carries protocolRecordId, protocolVersionId, version, userId and recordedByUserId.',
      },
    ],
  },
  {
    name: 'record_protocol_deviation_reason',
    label: 'Give the reason for a protocol deviation',
    summary: 'Give the reason for a protocol deviation',
    description:
      'Records why a step was done differently from the protocol. Returns the deviation.',
    kind: 'write',
    inputs: [input('p_deviation_id', 'uuid'), input('p_reason', 'text')],
    result: 'row:protocol_deviations',
    assistant: { tool: 'sheetbase.protocol.deviation_reason' },
    pipeline: {},
    events: [
      {
        name: 'protocol.deviation.updated',
        family: 'compliance',
        summary: 'A step deviation was recorded, or its reason was given.',
        producer: { entityType: 'protocol_deviation', operation: 'update' },
        notes:
          'Payload carries effect (`protocol_deviation` or `protocol_deviation_reason`) and deviationId.',
      },
    ],
  },
  {
    name: 'protocol_version_usage',
    label: 'See where a protocol version is used',
    summary: 'See where a protocol version is used',
    description:
      'Which experiments use a protocol version, and who has acknowledged it.',
    kind: 'read',
    inputs: [input('p_version_id', 'uuid')],
    result:
      'rows:protocol_version_id=uuid,used_by_count=int,used_by=json,acknowledged_count=int,acknowledged_by=json',
  },

  // -- Approval requests ----------------------------------------------------
  {
    name: 'submit_approval_request',
    label: 'Ask for an approval',
    summary: 'Ask for an approval',
    description:
      'Asks people in the named roles to approve something, such as a dataset schema version. Deciding it stays with them in the app. Returns the request.',
    kind: 'write',
    inputs: [
      input('p_workspace_id', 'uuid'),
      {
        ...input('p_object_kind', 'text'),
        description:
          'What is to be approved, such as `dataset_schema_version`.',
      },
      input('p_object_id', 'uuid'),
      {
        ...input('p_required_approver_roles', 'text[]'),
        description: 'Roles that may approve.',
      },
      input('p_reason', 'text'),
      {
        ...input('p_require_independence', 'bool', false),
        description: 'The person who asks may not approve (default true).',
      },
      {
        ...input('p_required_approvals', 'int', false),
        description: 'How many approvals are needed (default 1).',
      },
      input('p_object_revision', 'bigint', false),
    ],
    result: 'row:approval_requests',
    assistant: { tool: 'sheetbase.approval.request' },
    pipeline: {},
  },
  {
    name: 'withdraw_approval_request',
    label: 'Withdraw an approval request',
    summary: 'Withdraw an approval request',
    description:
      'Takes back a request that is still waiting. Returns the request.',
    kind: 'write',
    inputs: [
      input('p_request_id', 'uuid'),
      {
        ...input('p_reason', 'text', false),
        description: 'Why, in a sentence.',
      },
    ],
    result: 'row:approval_requests',
    assistant: { tool: 'sheetbase.approval.withdraw' },
    pipeline: {},
  },
])
