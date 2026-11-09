import type { z } from 'zod'

import {
  APPROVALS_READ_TOOL,
  APPROVAL_REQUEST_TOOL,
  APPROVAL_WITHDRAW_TOOL,
  COMMENTS_READ_TOOL,
  COMMENT_ADD_TOOL,
  COMMENT_REPLY_TOOL,
  COMMENT_RESOLVE_TOOL,
  FILES_READ_TOOL,
  FILE_DELETE_TOOL,
  FILE_QUARANTINE_TOOL,
  FILE_RESTORE_TOOL,
  PROTOCOL_CONFIRM_CURRENT_TOOL,
  proposeProtocolConfirmCurrentSchema,
  NOTEBOOK_PROPOSE_TOOL_NAMES,
  NOTEBOOK_READ_TOOL_NAMES,
  PROTOCOLS_READ_TOOL,
  PROTOCOL_ASSIGN_TRAINING_TOOL,
  PROTOCOL_DEVIATION_REASON_TOOL,
  PROTOCOL_NEW_VERSION_TOOL,
  PROTOCOL_RECORD_TRAINED_TOOL,
  PROTOCOL_SET_STATUS_TOOL,
  PROTOCOL_UNASSIGN_TRAINING_TOOL,
  approvalsReadSchema,
  commentsReadSchema,
  filesReadSchema,
  proposeApprovalRequestSchema,
  proposeApprovalWithdrawSchema,
  proposeCommentAddSchema,
  proposeCommentReplySchema,
  proposeCommentResolveSchema,
  proposeFileStatusSchema,
  proposeProtocolAssignTrainingSchema,
  proposeProtocolDeviationReasonSchema,
  proposeProtocolNewVersionSchema,
  proposeProtocolRecordTrainedSchema,
  proposeProtocolSetStatusSchema,
  proposeProtocolUnassignTrainingSchema,
  protocolsReadSchema,
} from './assistant-notebook'
import type {
  NotebookAction,
  NotebookProposeToolName,
} from './assistant-notebook'
import {
  invalid,
  likeValue,
  memberNames,
  toolDef,
} from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { ProviderToolDef } from './ai-providers/types'
import type { AssistantProposal, ProposalChange } from './assistant-proposals'
import type { DataClient } from './data-client'

/**
 * Notebook work from the assistant (see `assistant-notebook.ts`). Reads answer
 * from what the person can see. Each card builder finds what the person named
 * under their own access and returns a card saying exactly what will change.
 * Nothing is written here.
 */

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export type NotebookOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

type Lookup<T> = { ok: true; value: T } | { ok: false; message: string }

export const isNotebookReadTool = (name: string): boolean =>
  (NOTEBOOK_READ_TOOL_NAMES as readonly string[]).includes(name)

export const isNotebookProposalTool = (
  name: string,
): name is NotebookProposeToolName =>
  (NOTEBOOK_PROPOSE_TOOL_NAMES as readonly string[]).includes(name)

export function notebookReadDefs(): ProviderToolDef[] {
  return [
    toolDef(
      COMMENTS_READ_TOOL,
      'Read the comments on a notebook, thread by thread, with who wrote them and whether the thread is resolved.',
      commentsReadSchema,
    ),
    toolDef(
      PROTOCOLS_READ_TOOL,
      'Read a protocol: its versions and their status, and who is trained on it, who is out of date and who is overdue. With no protocol named, list the protocols.',
      protocolsReadSchema,
    ),
    toolDef(
      FILES_READ_TOOL,
      'Find uploaded files by words in their name or inside them, with their size, version and status.',
      filesReadSchema,
    ),
    toolDef(
      APPROVALS_READ_TOOL,
      'Read approval requests: what is waiting, who asked and what it is about. Deciding them is for people.',
      approvalsReadSchema,
    ),
  ]
}

export function notebookProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      COMMENT_ADD_TOOL,
      `Propose a comment on a notebook, optionally telling people. ${NOTE}`,
      proposeCommentAddSchema,
    ),
    toolDef(
      COMMENT_REPLY_TOOL,
      `Propose a reply to a comment thread on a notebook. ${NOTE}`,
      proposeCommentReplySchema,
    ),
    toolDef(
      COMMENT_RESOLVE_TOOL,
      `Propose resolving a comment thread, or opening a resolved one again. ${NOTE}`,
      proposeCommentResolveSchema,
    ),
    toolDef(
      FILE_QUARANTINE_TOOL,
      `Propose quarantining a file so it cannot be downloaded. ${NOTE}`,
      proposeFileStatusSchema,
    ),
    toolDef(
      FILE_RESTORE_TOOL,
      `Propose bringing a quarantined file back into use. ${NOTE}`,
      proposeFileStatusSchema,
    ),
    toolDef(
      FILE_DELETE_TOOL,
      `Propose deleting a file. It can be restored later. ${NOTE}`,
      proposeFileStatusSchema,
    ),
    toolDef(
      PROTOCOL_CONFIRM_CURRENT_TOOL,
      `Propose confirming that an effective protocol version is still current, with when it is next due for review. ${NOTE}`,
      proposeProtocolConfirmCurrentSchema,
    ),
    toolDef(
      PROTOCOL_NEW_VERSION_TOOL,
      `Propose freezing a protocol as it is now into a new draft version. ${NOTE}`,
      proposeProtocolNewVersionSchema,
    ),
    toolDef(
      PROTOCOL_SET_STATUS_TOOL,
      `Propose changing a protocol version’s status. A version cannot become effective until its approvals are in. ${NOTE}`,
      proposeProtocolSetStatusSchema,
    ),
    toolDef(
      PROTOCOL_ASSIGN_TRAINING_TOOL,
      `Propose asking someone to be trained on a protocol, optionally by a date. ${NOTE}`,
      proposeProtocolAssignTrainingSchema,
    ),
    toolDef(
      PROTOCOL_UNASSIGN_TRAINING_TOOL,
      `Propose taking someone off a protocol’s training list. ${NOTE}`,
      proposeProtocolUnassignTrainingSchema,
    ),
    toolDef(
      PROTOCOL_RECORD_TRAINED_TOOL,
      `Propose recording that someone was trained on a protocol, by the person who trained them. Reading a protocol for yourself is a person’s own act and is not done here. ${NOTE}`,
      proposeProtocolRecordTrainedSchema,
    ),
    toolDef(
      PROTOCOL_DEVIATION_REASON_TOOL,
      `Propose recording why a step of an experiment was done differently from its protocol. ${NOTE}`,
      proposeProtocolDeviationReasonSchema,
    ),
    toolDef(
      APPROVAL_REQUEST_TOOL,
      `Propose asking people in some roles to approve something. Approving or returning it is for them, not for the assistant. ${NOTE}`,
      proposeApprovalRequestSchema,
    ),
    toolDef(
      APPROVAL_WITHDRAW_TOOL,
      `Propose taking back an approval request that is still waiting. ${NOTE}`,
      proposeApprovalWithdrawSchema,
    ),
  ]
}

// ---------------------------------------------------------------------------
// Lookups.
// ---------------------------------------------------------------------------

function pick<T>(
  rows: readonly T[],
  wanted: string,
  what: string,
  label: (row: T) => string,
  exact: (row: T) => boolean,
): Lookup<T> {
  if (rows.length === 0)
    return { ok: false, message: `No ${what} matches "${wanted}".` }
  const same = rows.filter(exact)
  if (same.length === 1) return { ok: true, value: same[0] }
  if (rows.length === 1) return { ok: true, value: rows[0] }
  return {
    ok: false,
    message: `More than one ${what} matches "${wanted}": ${rows
      .map(label)
      .join('; ')}. Ask the person which one, naming these.`,
  }
}

interface RecordRow {
  id: string
  identifier: string
  title: string
  project_id: string | null
}

async function findRecord(
  client: DataClient,
  text: string,
  kind?: string,
): Promise<Lookup<RecordRow>> {
  const like = likeValue(text)
  const rows = await client.list<RecordRow>(
    'records',
    `?deleted_at=is.null${kind ? `&kind=eq.${kind}` : ''}&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title,project_id&order=updated_at.desc&limit=6`,
  )
  const lower = text.trim().toLowerCase()
  return pick(
    rows,
    text,
    kind === 'protocol_template' ? 'protocol' : 'record',
    (row) => `${row.identifier} ${row.title}`,
    (row) =>
      row.identifier.toLowerCase() === lower ||
      row.title.toLowerCase() === lower,
  )
}

async function findPerson(
  client: DataClient,
  text: string,
): Promise<Lookup<{ id: string; name: string }>> {
  const members = await memberNames(client)
  const lower = text.trim().toLowerCase()
  const words = lower.split(/\s+/).filter(Boolean)
  const matches = [...members.entries()]
    .map(([id, name]) => ({ id, name }))
    .filter((member) =>
      words.every((word) => member.name.toLowerCase().includes(word)),
    )
  return pick(
    matches,
    text,
    'person',
    (row) => row.name,
    (row) => row.name.toLowerCase() === lower,
  )
}

async function findPeople(
  client: DataClient,
  names: readonly string[] | undefined,
): Promise<Lookup<{ id: string; name: string }[]>> {
  const found: { id: string; name: string }[] = []
  for (const name of names ?? []) {
    const one = await findPerson(client, name)
    if (!one.ok) return one
    found.push(one.value)
  }
  return { ok: true, value: found }
}

interface CommentRow {
  id: string
  root_id: string
  parent_id: string | null
  body: string
  state: 'open' | 'resolved'
  author_user_id: string | null
  created_at: string
}

async function findThread(
  client: DataClient,
  recordId: string,
  words: string,
): Promise<Lookup<CommentRow>> {
  const rows = await client.rpc<CommentRow[]>('record_comments', {
    p_record_id: recordId,
  })
  const wanted = words.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = rows.filter((row) =>
    wanted.every((word) => row.body.toLowerCase().includes(word)),
  )
  return pick(
    matches,
    words,
    'comment',
    (row) => `"${row.body.slice(0, 60)}"`,
    () => false,
  )
}

interface VersionRow {
  id: string
  version: number
  status: string
  protocol_record_id: string
}

async function findVersion(
  client: DataClient,
  protocolId: string,
  version: number | undefined,
  prefer: 'newest' | 'effective',
): Promise<Lookup<VersionRow>> {
  const rows = await client.list<VersionRow>(
    'protocol_versions',
    `?protocol_record_id=eq.${protocolId}&select=id,version,status,protocol_record_id&order=version.desc&limit=50`,
  )
  if (rows.length === 0)
    return { ok: false, message: 'That protocol has no versions yet.' }
  if (version !== undefined) {
    const found = rows.find((row) => row.version === version)
    return found
      ? { ok: true, value: found }
      : { ok: false, message: `The protocol has no version ${version}.` }
  }
  if (prefer === 'effective') {
    const effective = rows.find((row) => row.status === 'effective')
    if (!effective)
      return {
        ok: false,
        message: 'No version of that protocol is in effect. Ask which version.',
      }
    return { ok: true, value: effective }
  }
  return { ok: true, value: rows[0] }
}

const fail = (message: string): NotebookOutcome => ({ ok: false, message })
const recordLink = (id: string) => `/records/${id}`
const when = (iso: string | null) => (iso ? iso.slice(0, 10) : null)

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

type ReadResult = { text: string; isError: boolean }

export async function runNotebookReadTool(
  name: string,
  args: unknown,
  context: LabToolContext,
): Promise<ReadResult> {
  try {
    switch (name) {
      case COMMENTS_READ_TOOL:
        return await readComments(args, context)
      case PROTOCOLS_READ_TOOL:
        return await readProtocols(args, context)
      case FILES_READ_TOOL:
        return await readFiles(args, context)
      default:
        return await readApprovals(args, context)
    }
  } catch {
    return { text: 'That could not be read just now.', isError: true }
  }
}

async function readComments(
  args: unknown,
  context: LabToolContext,
): Promise<ReadResult> {
  const parsed = commentsReadSchema.safeParse(args)
  if (!parsed.success) return { text: invalid(parsed.error), isError: true }
  const found = await findRecord(context.client, parsed.data.record)
  if (!found.ok) return { text: found.message, isError: true }
  const [rows, names] = await Promise.all([
    context.client.rpc<CommentRow[]>('record_comments', {
      p_record_id: found.value.id,
    }),
    memberNames(context.client),
  ])
  const roots = new Map(rows.filter((r) => !r.parent_id).map((r) => [r.id, r]))
  const comments = rows
    .filter((row) => !parsed.data.openOnly || row.state === 'open')
    .slice(0, 60)
    .map((row) => ({
      id: row.id,
      thread: row.root_id,
      reply: row.parent_id !== null,
      by: row.author_user_id
        ? (names.get(row.author_user_id) ?? 'Someone who has left')
        : 'Unknown',
      on: when(row.created_at),
      resolved: (roots.get(row.root_id)?.state ?? row.state) === 'resolved',
      body: row.body,
    }))
  return {
    text: JSON.stringify({
      notebook: `${found.value.identifier} ${found.value.title}`,
      open: recordLink(found.value.id),
      count: comments.length,
      comments,
    }),
    isError: false,
  }
}

async function readProtocols(
  args: unknown,
  context: LabToolContext,
): Promise<ReadResult> {
  const parsed = protocolsReadSchema.safeParse(args)
  if (!parsed.success) return { text: invalid(parsed.error), isError: true }
  if (!parsed.data.protocol) {
    const rows = await context.client.list<RecordRow>(
      'records',
      '?kind=eq.protocol_template&deleted_at=is.null&select=id,identifier,title,project_id&order=title.asc&limit=40',
    )
    return {
      text: JSON.stringify({
        protocols: rows.map((row) => ({
          identifier: row.identifier,
          title: row.title,
          open: recordLink(row.id),
        })),
      }),
      isError: false,
    }
  }
  const found = await findRecord(
    context.client,
    parsed.data.protocol,
    'protocol_template',
  )
  if (!found.ok) return { text: found.message, isError: true }
  const [versions, training, names] = await Promise.all([
    context.client.list<
      VersionRow & {
        change_summary: string | null
        effective_at: string | null
      }
    >(
      'protocol_versions',
      `?protocol_record_id=eq.${found.value.id}&select=id,version,status,protocol_record_id,change_summary,effective_at&order=version.desc&limit=20`,
    ),
    context.client.list<{
      user_id: string
      status: string
      trained_version: number | null
      due_at: string | null
      overdue: boolean | null
    }>(
      'protocol_training_status',
      `?protocol_record_id=eq.${found.value.id}&order=user_id.asc&limit=100`,
    ),
    memberNames(context.client),
  ])
  return {
    text: JSON.stringify({
      protocol: `${found.value.identifier} ${found.value.title}`,
      open: recordLink(found.value.id),
      versions: versions.map((v) => ({
        version: v.version,
        status: v.status,
        changed: v.change_summary,
        effectiveOn: when(v.effective_at),
      })),
      training: training.map((t) => ({
        person: names.get(t.user_id) ?? 'Someone who has left',
        status: t.status,
        trainedOnVersion: t.trained_version,
        dueOn: when(t.due_at),
        overdue: t.overdue === true,
      })),
    }),
    isError: false,
  }
}

async function readFiles(
  args: unknown,
  context: LabToolContext,
): Promise<ReadResult> {
  const parsed = filesReadSchema.safeParse(args)
  if (!parsed.success) return { text: invalid(parsed.error), isError: true }
  const { name, contains } = parsed.data
  if (contains) {
    const rows = await context.client.rpc<
      Array<{
        file_id: string
        record_id: string
        identifier: string
        display_name: string
        line_number: number
        snippet: string
      }>
    >('search_file_contents', { p_query: contains, p_limit: 15 })
    return {
      text: JSON.stringify({
        matches: rows.map((row) => ({
          file: row.display_name,
          line: row.line_number,
          snippet: row.snippet,
          open: recordLink(row.record_id),
        })),
      }),
      isError: false,
    }
  }
  const filter = name ? `&display_name=ilike.${likeValue(name)}` : ''
  const rows = await context.client.list<{
    id: string
    record_id: string
    display_name: string
    media_type: string
    byte_size: number | string
    version: number
    status: string
  }>(
    'file_objects',
    `?deleted_at=is.null${filter}&select=id,record_id,display_name,media_type,byte_size,version,status&order=updated_at.desc&limit=25`,
  )
  return {
    text: JSON.stringify({
      files: rows.map((row) => ({
        name: row.display_name,
        type: row.media_type,
        bytes: Number(row.byte_size),
        version: row.version,
        status: row.status,
        open: recordLink(row.record_id),
      })),
    }),
    isError: false,
  }
}

async function readApprovals(
  args: unknown,
  context: LabToolContext,
): Promise<ReadResult> {
  const parsed = approvalsReadSchema.safeParse(args)
  if (!parsed.success) return { text: invalid(parsed.error), isError: true }
  const [rows, names] = await Promise.all([
    context.client.list<{
      id: string
      object_kind: string
      object_id: string
      state: string
      reason: string | null
      decision_reason: string | null
      required_approver_roles: string[]
      required_approvals: number
      approved_by_user_ids: string[]
      submitted_by_user_id: string | null
      submitted_at: string
    }>(
      'approval_requests',
      `?state=eq.${parsed.data.state ?? 'pending'}&select=*&order=submitted_at.desc&limit=30`,
    ),
    memberNames(context.client),
  ])
  return {
    text: JSON.stringify({
      requests: rows.map((row) => ({
        id: row.id,
        about: row.object_kind.replaceAll('_', ' '),
        state: row.state,
        reason: row.reason,
        decisionReason: row.decision_reason,
        askedBy: row.submitted_by_user_id
          ? (names.get(row.submitted_by_user_id) ?? 'Someone who has left')
          : null,
        on: when(row.submitted_at),
        rolesWhoCanApprove: row.required_approver_roles,
        approvalsNeeded: row.required_approvals,
        approvalsSoFar: row.approved_by_user_ids.length,
      })),
      note: 'Approving or returning a request is done by people in the app.',
    }),
    isError: false,
  }
}

// ---------------------------------------------------------------------------
// Cards.
// ---------------------------------------------------------------------------

function card(
  name: NotebookProposeToolName,
  input: { title: string; summary: string },
  target: string,
  deepLink: string | null,
  changes: ProposalChange[],
  action: NotebookAction,
): NotebookOutcome {
  return {
    ok: true,
    proposal: {
      tool: name,
      title: input.title,
      summary: input.summary,
      target,
      deepLink,
      changes,
      action,
    },
  }
}

const names = (people: readonly { name: string }[]) =>
  people.map((p) => p.name).join(', ')

export async function buildNotebookProposal(
  name: NotebookProposeToolName,
  args: unknown,
  context: LabToolContext,
): Promise<NotebookOutcome> {
  const client = context.client
  const bad = (error: z.ZodError) => fail(invalid(error))
  switch (name) {
    case COMMENT_ADD_TOOL: {
      const parsed = proposeCommentAddSchema.safeParse(args)
      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const found = await findRecord(client, input.record)
      if (!found.ok) return fail(found.message)
      const people = await findPeople(client, input.mentions)
      if (!people.ok) return fail(people.message)
      const changes: ProposalChange[] = [
        { label: 'Notebook', before: null, after: found.value.identifier },
        { label: 'Comment', before: null, after: input.body },
      ]
      if (people.value.length > 0)
        changes.push({
          label: 'Tells',
          before: null,
          after: names(people.value),
        })
      return card(
        name,
        input,
        `${found.value.identifier} · Comment`,
        recordLink(found.value.id),
        changes,
        {
          kind: 'notebook.comment_add',
          recordId: found.value.id,
          body: input.body,
          mentions: people.value.map((p) => p.id),
        },
      )
    }
    case COMMENT_REPLY_TOOL: {
      const parsed = proposeCommentReplySchema.safeParse(args)
      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const found = await findRecord(client, input.record)
      if (!found.ok) return fail(found.message)
      const thread = await findThread(client, found.value.id, input.thread)
      if (!thread.ok) return fail(thread.message)
      const people = await findPeople(client, input.mentions)
      if (!people.ok) return fail(people.message)
      return card(
        name,
        input,
        `${found.value.identifier} · Comment`,
        recordLink(found.value.id),
        [
          {
            label: 'Replying to',
            before: null,
            after: thread.value.body.slice(0, 120),
          },
          { label: 'Reply', before: null, after: input.body },
        ],
        {
          kind: 'notebook.comment_reply',
          commentId: thread.value.id,
          body: input.body,
          mentions: people.value.map((p) => p.id),
        },
      )
    }
    case COMMENT_RESOLVE_TOOL: {
      const parsed = proposeCommentResolveSchema.safeParse(args)
      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const found = await findRecord(client, input.record)
      if (!found.ok) return fail(found.message)
      const thread = await findThread(client, found.value.id, input.thread)
      if (!thread.ok) return fail(thread.message)
      const reopen = input.reopen ?? false
      return card(
        name,
        input,
        `${found.value.identifier} · Comment`,
        recordLink(found.value.id),
        [
          {
            label: 'Thread',
            before: reopen ? 'resolved' : 'open',
            after: reopen ? 'open' : 'resolved',
          },
          {
            label: 'Comment',
            before: null,
            after: thread.value.body.slice(0, 120),
          },
        ],
        {
          kind: 'notebook.comment_resolve',
          commentId: thread.value.id,
          reopen,
        },
      )
    }
    case FILE_QUARANTINE_TOOL:
    case FILE_RESTORE_TOOL:
    case FILE_DELETE_TOOL: {
      const parsed = proposeFileStatusSchema.safeParse(args)
      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const quarantine = name === FILE_QUARANTINE_TOOL
      const remove = name === FILE_DELETE_TOOL
      const rows = await client.list<{
        id: string
        record_id: string
        display_name: string
        status: string
        version: number
      }>(
        'file_objects',
        `?display_name=ilike.${likeValue(input.file)}&status=${remove ? 'in.(active,quarantined)' : quarantine ? 'eq.active' : 'eq.quarantined'}&select=id,record_id,display_name,status,version&order=updated_at.desc&limit=6`,
      )
      const found = pick(
        rows,
        input.file,
        'file',
        (row) => row.display_name,
        (row) => row.display_name.toLowerCase() === input.file.toLowerCase(),
      )
      if (!found.ok) return fail(found.message)
      return card(
        name,
        input,
        `${found.value.display_name} · File`,
        recordLink(found.value.record_id),
        [
          {
            label: 'File',
            before: found.value.status,
            after: remove ? 'deleted' : quarantine ? 'quarantined' : 'in use',
          },
          ...((quarantine || remove) && input.reason
            ? [{ label: 'Why', before: null, after: input.reason }]
            : []),
        ],
        {
          kind: 'notebook.file_status',
          fileId: found.value.id,
          expectedVersion: found.value.version,
          status: remove ? 'delete' : quarantine ? 'quarantine' : 'restore',
          reason: quarantine || remove ? (input.reason ?? null) : null,
        },
      )
    }
    case PROTOCOL_NEW_VERSION_TOOL: {
      const parsed = proposeProtocolNewVersionSchema.safeParse(args)
      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const found = await findRecord(
        client,
        input.protocol,
        'protocol_template',
      )
      if (!found.ok) return fail(found.message)
      return card(
        name,
        input,
        `${found.value.identifier} · Protocol`,
        recordLink(found.value.id),
        [
          {
            label: 'New version',
            before: null,
            after: 'draft, as the protocol is now',
          },
          { label: 'What changed', before: null, after: input.changeSummary },
        ],
        {
          kind: 'notebook.protocol_new_version',
          protocolRecordId: found.value.id,
          changeSummary: input.changeSummary,
          reason: input.reason ?? null,
        },
      )
    }
    case PROTOCOL_SET_STATUS_TOOL: {
      const parsed = proposeProtocolSetStatusSchema.safeParse(args)
      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const found = await findRecord(
        client,
        input.protocol,
        'protocol_template',
      )
      if (!found.ok) return fail(found.message)
      const version = await findVersion(
        client,
        found.value.id,
        input.version,
        'newest',
      )
      if (!version.ok) return fail(version.message)
      return card(
        name,
        input,
        `${found.value.identifier} v${version.value.version} · Protocol`,
        recordLink(found.value.id),
        [
          {
            label: 'Version status',
            before: version.value.status.replaceAll('_', ' '),
            after: input.status.replaceAll('_', ' '),
          },
          ...(input.reason
            ? [{ label: 'Why', before: null, after: input.reason }]
            : []),
        ],
        {
          kind: 'notebook.protocol_set_status',
          versionId: version.value.id,
          status: input.status,
          reason: input.reason ?? null,
        },
      )
    }
    case PROTOCOL_CONFIRM_CURRENT_TOOL: {
      const parsed = proposeProtocolConfirmCurrentSchema.safeParse(args)
      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const found = await findRecord(
        client,
        input.protocol,
        'protocol_template',
      )
      if (!found.ok) return fail(found.message)
      const version = await findVersion(
        client,
        found.value.id,
        input.version,
        'newest',
      )
      if (!version.ok) return fail(version.message)
      return card(
        name,
        input,
        `${found.value.identifier} v${version.value.version} · Protocol`,
        recordLink(found.value.id),
        [
          {
            label: 'Confirmed current',
            before: null,
            after: input.nextReviewDueAt
              ? `next review ${input.nextReviewDueAt}`
              : 'yes',
          },
          ...(input.reason
            ? [{ label: 'Why', before: null, after: input.reason }]
            : []),
        ],
        {
          kind: 'notebook.protocol_confirm_current',
          versionId: version.value.id,
          nextReviewDueAt: input.nextReviewDueAt ?? null,
          reason: input.reason ?? null,
        },
      )
    }
    case PROTOCOL_ASSIGN_TRAINING_TOOL:
    case PROTOCOL_UNASSIGN_TRAINING_TOOL:
    case PROTOCOL_RECORD_TRAINED_TOOL: {
      const parsed =
        name === PROTOCOL_ASSIGN_TRAINING_TOOL
          ? proposeProtocolAssignTrainingSchema.safeParse(args)
          : name === PROTOCOL_UNASSIGN_TRAINING_TOOL
            ? proposeProtocolUnassignTrainingSchema.safeParse(args)
            : proposeProtocolRecordTrainedSchema.safeParse(args)
      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data as {
        title: string
        summary: string
        protocol: string
        person: string
        dueOn?: string
        notes?: string
        version?: number
      }
      const found = await findRecord(
        client,
        input.protocol,
        'protocol_template',
      )
      if (!found.ok) return fail(found.message)
      const who = await findPerson(client, input.person)
      if (!who.ok) return fail(who.message)
      const target = `${found.value.identifier} · Protocol`
      const link = recordLink(found.value.id)
      if (name === PROTOCOL_ASSIGN_TRAINING_TOOL) {
        return card(
          name,
          input,
          target,
          link,
          [
            { label: 'Training', before: null, after: who.value.name },
            ...(input.dueOn
              ? [{ label: 'Due', before: null, after: input.dueOn }]
              : []),
          ],
          {
            kind: 'notebook.protocol_assign_training',
            protocolRecordId: found.value.id,
            userId: who.value.id,
            dueAt: input.dueOn ? `${input.dueOn}T00:00:00Z` : null,
            notes: input.notes ?? null,
          },
        )
      }
      if (name === PROTOCOL_UNASSIGN_TRAINING_TOOL) {
        return card(
          name,
          input,
          target,
          link,
          [{ label: 'Training', before: who.value.name, after: 'removed' }],
          {
            kind: 'notebook.protocol_unassign_training',
            protocolRecordId: found.value.id,
            userId: who.value.id,
          },
        )
      }
      const version = await findVersion(
        client,
        found.value.id,
        input.version,
        'effective',
      )
      if (!version.ok) return fail(version.message)
      return card(
        name,
        input,
        target,
        link,
        [
          {
            label: 'Trained',
            before: null,
            after: `${who.value.name} on version ${version.value.version}`,
          },
        ],
        {
          kind: 'notebook.protocol_record_trained',
          versionId: version.value.id,
          userId: who.value.id,
          notes: input.notes ?? null,
        },
      )
    }
    case PROTOCOL_DEVIATION_REASON_TOOL: {
      const parsed = proposeProtocolDeviationReasonSchema.safeParse(args)
      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const found = await findRecord(client, input.record)
      if (!found.ok) return fail(found.message)
      const rows = await client.list<{
        id: string
        recorded_text: string
        reason: string | null
      }>(
        'protocol_deviations',
        `?record_id=eq.${found.value.id}&select=id,recorded_text,reason&order=created_at.desc&limit=50`,
      )
      const wanted = (input.step ?? '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
      const open = rows.filter(
        (row) =>
          wanted.every((w) => row.recorded_text.toLowerCase().includes(w)) &&
          (wanted.length > 0 || row.reason === null),
      )
      const deviation = pick(
        open,
        input.step ?? 'a step without a reason',
        'deviation',
        (row) => `"${row.recorded_text.slice(0, 60)}"`,
        () => false,
      )
      if (!deviation.ok) return fail(deviation.message)
      return card(
        name,
        input,
        `${found.value.identifier} · Deviation`,
        recordLink(found.value.id),
        [
          {
            label: 'Step done as',
            before: null,
            after: deviation.value.recorded_text.slice(0, 160),
          },
          {
            label: 'Reason',
            before: deviation.value.reason,
            after: input.reason,
          },
        ],
        {
          kind: 'notebook.deviation_reason',
          deviationId: deviation.value.id,
          reason: input.reason,
        },
      )
    }
    case APPROVAL_REQUEST_TOOL: {
      const parsed = proposeApprovalRequestSchema.safeParse(args)
      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      return card(
        name,
        input,
        `${input.objectKind.replaceAll('_', ' ')} · Approval`,
        null,
        [
          { label: 'Asks', before: null, after: input.roles.join(', ') },
          { label: 'Why', before: null, after: input.reason },
          {
            label: 'Approvals needed',
            before: null,
            after: String(input.approvals ?? 1),
          },
        ],
        {
          kind: 'notebook.approval_request',
          workspaceId: context.workspaceId,
          objectKind: input.objectKind,
          objectId: input.objectId,
          roles: input.roles,
          reason: input.reason,
          approvals: input.approvals ?? 1,
        },
      )
    }
    case APPROVAL_WITHDRAW_TOOL: {
      const parsed = proposeApprovalWithdrawSchema.safeParse(args)
      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const rows = await client.list<{
        id: string
        object_kind: string
        reason: string | null
      }>(
        'approval_requests',
        `?state=eq.pending${input.request ? `&id=eq.${input.request}` : `&submitted_by_user_id=eq.${context.userId}`}&select=id,object_kind,reason&order=submitted_at.desc&limit=6`,
      )
      const found = pick(
        rows,
        input.request ?? 'a request of yours',
        'waiting request',
        (row) => `${row.object_kind.replaceAll('_', ' ')} (${row.id})`,
        () => false,
      )
      if (!found.ok) return fail(found.message)
      return card(
        name,
        input,
        `${found.value.object_kind.replaceAll('_', ' ')} · Approval`,
        null,
        [
          { label: 'Request', before: 'waiting', after: 'withdrawn' },
          ...(input.reason
            ? [{ label: 'Why', before: null, after: input.reason }]
            : []),
        ],
        {
          kind: 'notebook.approval_withdraw',
          requestId: found.value.id,
          reason: input.reason ?? null,
        },
      )
    }
  }
}
