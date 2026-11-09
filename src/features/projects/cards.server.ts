import {
  AUDIT_VERIFY_TOOL,
  FOLDER_CREATE_TOOL,
  FOLDER_DELETE_TOOL,
  FOLDER_MOVE_ITEMS_TOOL,
  FOLDER_MOVE_RECORDS_TOOL,
  FOLDER_RENAME_TOOL,
  PROJECTS_PROPOSE_TOOL_NAMES,
  PROJECT_ARCHIVE_TOOL,
  PROJECT_COPY_PLAN_TOOL,
  PROJECT_COPY_TOOL,
  PROJECT_RESTORE_TOOL,
  PROJECT_UPDATE_TOOL,
  RECORD_FOLLOW_TOOL,
  RECORD_MOVE_PROJECT_TOOL,
  RECORD_UNFOLLOW_TOOL,
  SQL_LOGIN_REVOKE_TOOL,
  proposeAuditVerifySchema,
  proposeFolderCreateSchema,
  proposeFolderDeleteSchema,
  proposeFolderMoveItemsSchema,
  proposeFolderMoveRecordsSchema,
  proposeFolderRenameSchema,
  proposeProjectCopyPlanSchema,
  proposeProjectCopySchema,
  proposeProjectStateSchema,
  proposeProjectUpdateSchema,
  proposeRecordFollowSchema,
  proposeRecordMoveProjectSchema,
  proposeSqlLoginRevokeSchema,
} from './cards'
import type { ProjectsAction, ProjectsProposeToolName } from './cards'
import { likeValue, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { parse, pick } from '#/lib/assistant-upkeep.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import type {
  AssistantProposal,
  ProposalChange,
} from '#/lib/assistant-proposals'
import type { DataClient } from '#/lib/data-client'
import type { ProviderToolDef } from '#/lib/ai-providers/types'

/**
 * Cards for projects, folders, following, the audit check and SQL logins (see
 * `assistant.ts`). Each builder finds what the model named under the signed-in
 * person's own access and returns a card that says exactly what will change.
 * Nothing is written here; the button calls the ordinary RPC.
 */

export type ProjectsOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isProjectsProposalTool(
  name: string,
): name is ProjectsProposeToolName {
  return PROJECTS_PROPOSE_TOOL_NAMES.includes(name)
}

export function projectsProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      PROJECT_UPDATE_TOOL,
      `Propose changing a project's name, client, lead, default reviewer, modality, stage, agreement reference or start date. Leave out what stays. For people who manage the project. ${NOTE}`,
      proposeProjectUpdateSchema,
    ),
    toolDef(
      PROJECT_ARCHIVE_TOOL,
      `Propose archiving a project, which hides it from everyday lists. Nothing is deleted and it can be restored. ${NOTE}`,
      proposeProjectStateSchema,
    ),
    toolDef(
      PROJECT_RESTORE_TOOL,
      `Propose bringing an archived project back. ${NOTE}`,
      proposeProjectStateSchema,
    ),
    toolDef(
      PROJECT_COPY_TOOL,
      `Propose starting a new project like an existing one: it gets the source's plan (tasks and deliverables, set back to not started) and none of its records. ${NOTE}`,
      proposeProjectCopySchema,
    ),
    toolDef(
      PROJECT_COPY_PLAN_TOOL,
      `Propose copying one project's plan (phases, milestones and their conditions) into another project, starting on a date. ${NOTE}`,
      proposeProjectCopyPlanSchema,
    ),
    toolDef(
      RECORD_MOVE_PROJECT_TOOL,
      `Propose moving a record, with everything in it, to another project. ${NOTE}`,
      proposeRecordMoveProjectSchema,
    ),
    toolDef(
      FOLDER_CREATE_TOOL,
      `Propose making a folder in a project, optionally inside another folder. ${NOTE}`,
      proposeFolderCreateSchema,
    ),
    toolDef(
      FOLDER_RENAME_TOOL,
      `Propose renaming a folder. ${NOTE}`,
      proposeFolderRenameSchema,
    ),
    toolDef(
      FOLDER_DELETE_TOOL,
      `Propose deleting a folder. It must hold no records; folders inside it move up a level. Ask first if the person has not clearly said so. ${NOTE}`,
      proposeFolderDeleteSchema,
    ),
    toolDef(
      FOLDER_MOVE_RECORDS_TOOL,
      `Propose putting records of one project into one of its folders, or taking them out of their folder. ${NOTE}`,
      proposeFolderMoveRecordsSchema,
    ),
    toolDef(
      FOLDER_MOVE_ITEMS_TOOL,
      `Propose filing datasets, sheets, analysis views or pipelines in a folder, or taking them out of their folder. ${NOTE}`,
      proposeFolderMoveItemsSchema,
    ),
    toolDef(
      RECORD_FOLLOW_TOOL,
      `Propose following a record, so its changes show in the person's Inbox. ${NOTE}`,
      proposeRecordFollowSchema,
    ),
    toolDef(
      RECORD_UNFOLLOW_TOOL,
      `Propose no longer following a record. ${NOTE}`,
      proposeRecordFollowSchema,
    ),
    toolDef(
      AUDIT_VERIFY_TOOL,
      `Propose checking the audit log and every signed record now, the check that also runs each night. It changes nothing but adds its result to the audit log. For people who manage audit settings. ${NOTE}`,
      proposeAuditVerifySchema,
    ),
    toolDef(
      SQL_LOGIN_REVOKE_TOOL,
      `Propose revoking a read-only SQL login, which stops working at once. Read the sql_logins area first to see which exist. ${NOTE}`,
      proposeSqlLoginRevokeSchema,
    ),
  ]
}

const fail = (message: string): ProjectsOutcome => ({ ok: false, message })

function card(
  tool: ProjectsProposeToolName,
  input: { title: string; summary: string },
  rest: {
    target: string
    deepLink: string | null
    changes: ProposalChange[]
    action: ProjectsAction
  },
): ProjectsOutcome {
  return {
    ok: true,
    proposal: { tool, title: input.title, summary: input.summary, ...rest },
  }
}

interface ProjectRow {
  id: string
  title: string
  key: string
  display_id: string | null
  revision: number
  archived_at: string | null
  client_id: string | null
  modality: string | null
  stage: string | null
  lead_user_id: string | null
  default_reviewer_user_id: string | null
  agreement_reference: string | null
  started_on: string | null
}

const PROJECT_COLUMNS =
  'id,title,key,display_id,revision,archived_at,client_id,modality,stage,lead_user_id,default_reviewer_user_id,agreement_reference,started_on'

async function findProject(
  client: DataClient,
  text: string,
  archived: 'active' | 'archived' | 'any' = 'active',
): Promise<Lookup<ProjectRow>> {
  const like = likeValue(text)

  const state =
    archived === 'active'
      ? 'archived_at=is.null&'
      : archived === 'archived'
        ? 'archived_at=not.is.null&'
        : ''

  const rows = await client.list<ProjectRow>(
    'projects',
    `?${state}or=(title.ilike.${like},key.ilike.${like},display_id.ilike.${like})&select=${PROJECT_COLUMNS}&order=title.asc&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  return pick(
    rows,
    text,
    archived === 'archived' ? 'archived project' : 'project',
    (row) => projectLabel(row),
    (row) =>
      row.title.toLowerCase() === lower ||
      row.key.toLowerCase() === lower ||
      (row.display_id ?? '').toLowerCase() === lower,
  )
}

const projectLabel = (row: { title: string; display_id: string | null }) =>
  row.display_id ? `${row.display_id} ${row.title}` : row.title

interface RecordRow {
  id: string
  identifier: string
  title: string
  project_id: string
  folder_id: string | null
  metadata_version: number
}

async function findRecord(
  client: DataClient,
  text: string,
  projectId?: string,
): Promise<Lookup<RecordRow>> {
  const like = likeValue(text)
  const inProject = projectId ? `project_id=eq.${projectId}&` : ''

  const rows = await client.list<RecordRow>(
    'records',
    `?${inProject}deleted_at=is.null&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title,project_id,folder_id,metadata_version&order=updated_at.desc&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  return pick(
    rows,
    text,
    projectId ? 'record in that project' : 'record',
    (row) => `${row.identifier} ${row.title}`,
    (row) =>
      row.identifier.toLowerCase() === lower ||
      row.title.toLowerCase() === lower,
  )
}

interface FolderRow {
  id: string
  name: string
  identifier: string | null
}

async function findFolder(
  client: DataClient,
  projectId: string,
  text: string,
): Promise<Lookup<FolderRow>> {
  const rows = await client.list<FolderRow>(
    'folders',
    `?project_id=eq.${projectId}&archived_at=is.null&name=ilike.${likeValue(text)}&select=id,name,identifier&order=name.asc&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  return pick(
    rows,
    text,
    'folder in that project',
    (row) => row.name,
    (row) => row.name.toLowerCase() === lower,
  )
}

interface MemberRow {
  user_id: string
  name: string
}

async function findMember(
  client: DataClient,
  text: string,
): Promise<Lookup<MemberRow>> {
  const members = await client.rpc<MemberRow[]>('workspace_members_list', {})
  const lower = text.trim().toLowerCase()
  const words = lower.split(/\s+/).filter(Boolean)

  return pick(
    members.filter((member) =>
      words.every((word) => member.name.toLowerCase().includes(word)),
    ),
    text,
    'member',
    (row) => row.name,
    (row) => row.name.toLowerCase() === lower || row.user_id === text.trim(),
  )
}

async function findClient(
  client: DataClient,
  text: string,
): Promise<Lookup<{ id: string; code: string; name: string }>> {
  const like = likeValue(text)

  const rows = await client.list<{ id: string; code: string; name: string }>(
    'clients',
    `?archived_at=is.null&or=(name.ilike.${like},code.ilike.${like})&select=id,code,name&order=name.asc&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  return pick(
    rows,
    text,
    'client',
    (row) => `${row.name} (${row.code})`,
    (row) =>
      row.name.toLowerCase() === lower || row.code.toLowerCase() === lower,
  )
}

type Details = {
  client?: string
  modality?: string
  stage?: string
  lead?: string
  reviewer?: string
  agreement?: string
  startedOn?: string
}

/** Turns the details the model named into RPC arguments and card lines. */
async function resolveDetails(
  client: DataClient,
  input: Details,
): Promise<
  | {
      ok: true
      fields: Record<string, string | null>
      changes: ProposalChange[]
    }
  | { ok: false; message: string }
> {
  const fields: Record<string, string | null> = {}
  const changes: ProposalChange[] = []

  if (input.client) {
    const found = await findClient(client, input.client)

    if (!found.ok) return found
    fields.p_client_id = found.value.id
    changes.push({ label: 'Client', before: null, after: found.value.name })
  }

  if (input.lead) {
    const found = await findMember(client, input.lead)

    if (!found.ok) return found
    fields.p_lead_user_id = found.value.user_id
    changes.push({ label: 'Lead', before: null, after: found.value.name })
  }

  if (input.reviewer) {
    const found = await findMember(client, input.reviewer)

    if (!found.ok) return found
    fields.p_default_reviewer_user_id = found.value.user_id
    changes.push({
      label: 'Default reviewer',
      before: null,
      after: found.value.name,
    })
  }

  const plain: Array<[keyof Details, string, string]> = [
    ['modality', 'p_modality', 'Modality'],
    ['stage', 'p_stage', 'Stage'],
    ['agreement', 'p_agreement_reference', 'Agreement'],
    ['startedOn', 'p_started_on', 'Started'],
  ]

  for (const [key, arg, label] of plain) {
    const value = input[key]

    if (value === undefined) continue
    fields[arg] = value
    changes.push({ label, before: null, after: value })
  }

  return { ok: true, fields, changes }
}

const ITEM_TABLES = {
  dataset: { table: 'datasets', what: 'dataset' },
  sheet_instance: { table: 'sheet_instances', what: 'sheet' },
  analysis_view: { table: 'analysis_views', what: 'analysis view' },
  pipeline_definition: { table: 'pipeline_definitions', what: 'pipeline' },
} as const

export async function buildProjectsProposal(
  name: ProjectsProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Each tool case parses raw input before using it or accessing data.
  args: unknown,
  context: LabToolContext,
): Promise<ProjectsOutcome> {
  const { client, workspaceId } = context

  switch (name) {
    case PROJECT_UPDATE_TOOL: {
      const parsed = parse(proposeProjectUpdateSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const project = await findProject(client, input.project, 'any')

      if (!project.ok) return fail(project.message)
      const details = await resolveDetails(client, input)

      if (!details.ok) return fail(details.message)
      const fields = { ...details.fields }
      const changes: ProposalChange[] = []

      if (input.name && input.name !== project.value.title) {
        fields.p_title = input.name
        changes.push({
          label: 'Name',
          before: project.value.title,
          after: input.name,
        })
      }

      changes.push(...details.changes)

      if (changes.length === 0)
        return fail('Nothing to change. Ask what should change.')

      return card(name, input, {
        target: projectLabel(project.value),
        deepLink: `/projects/${project.value.id}`,
        changes,
        action: {
          kind: 'project.update',
          projectId: project.value.id,
          expectedRevision: project.value.revision,
          fields,
        },
      })
    }

    case PROJECT_ARCHIVE_TOOL:
    case PROJECT_RESTORE_TOOL: {
      const parsed = parse(proposeProjectStateSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const archive = name === PROJECT_ARCHIVE_TOOL

      const project = await findProject(
        client,
        input.project,
        archive ? 'active' : 'archived',
      )

      if (!project.ok) return fail(project.message)

      return card(name, input, {
        target: projectLabel(project.value),
        deepLink: `/projects/${project.value.id}`,
        changes: [
          {
            label: 'Project',
            before: archive ? 'Active' : 'Archived',
            after: archive ? 'Archived' : 'Active',
          },
        ],
        action: {
          kind: archive ? 'project.archive' : 'project.restore',
          projectId: project.value.id,
        },
      })
    }

    case PROJECT_COPY_TOOL: {
      const parsed = parse(proposeProjectCopySchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const source = await findProject(client, input.source, 'any')

      if (!source.ok) return fail(source.message)
      const details = await resolveDetails(client, input)

      if (!details.ok) return fail(details.message)

      return card(name, input, {
        target: input.name,
        deepLink: '/projects',
        changes: [
          { label: 'New project', before: null, after: input.name },
          {
            label: 'Plan copied from',
            before: null,
            after: projectLabel(source.value),
          },
          ...details.changes,
        ],
        action: {
          kind: 'project.copy',
          sourceId: source.value.id,
          expectedRevision: source.value.revision,
          name: input.name,
          fields: details.fields,
        },
      })
    }

    case PROJECT_COPY_PLAN_TOOL: {
      const parsed = parse(proposeProjectCopyPlanSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const source = await findProject(client, input.source, 'any')

      if (!source.ok) return fail(source.message)
      const target = await findProject(client, input.target)

      if (!target.ok) return fail(target.message)

      if (source.value.id === target.value.id)
        return fail('A plan cannot be copied into its own project.')

      return card(name, input, {
        target: projectLabel(target.value),
        deepLink: `/projects/${target.value.id}`,
        changes: [
          {
            label: 'Plan copied from',
            before: null,
            after: projectLabel(source.value),
          },
          { label: 'Starts', before: null, after: input.startDate },
        ],
        action: {
          kind: 'project.copy_plan',
          sourceId: source.value.id,
          targetId: target.value.id,
          startDate: input.startDate,
        },
      })
    }

    case RECORD_MOVE_PROJECT_TOOL: {
      const parsed = parse(proposeRecordMoveProjectSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const record = await findRecord(client, input.record)

      if (!record.ok) return fail(record.message)
      const project = await findProject(client, input.project)

      if (!project.ok) return fail(project.message)

      if (record.value.project_id === project.value.id)
        return fail(
          `${record.value.identifier} is already in ${project.value.title}.`,
        )

      const from = await client.list<{
        title: string
        display_id: string | null
      }>(
        'projects',
        `?id=eq.${record.value.project_id}&select=title,display_id&limit=1`,
      )

      return card(name, input, {
        target: `${record.value.identifier} ${record.value.title}`,
        deepLink: `/records/${record.value.id}`,
        changes: [
          {
            label: 'Project',
            before: from[0] ? projectLabel(from[0]) : null,
            after: projectLabel(project.value),
          },
        ],
        action: {
          kind: 'record.move_project',
          recordId: record.value.id,
          projectId: project.value.id,
          expectedMetadataVersion: record.value.metadata_version,
        },
      })
    }

    case FOLDER_CREATE_TOOL: {
      const parsed = parse(proposeFolderCreateSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const project = await findProject(client, input.project)

      if (!project.ok) return fail(project.message)
      let parentId: string | null = null

      const changes: ProposalChange[] = [
        { label: 'New folder', before: null, after: input.name },
      ]

      if (input.parent) {
        const parent = await findFolder(client, project.value.id, input.parent)

        if (!parent.ok) return fail(parent.message)
        parentId = parent.value.id
        changes.push({
          label: 'Inside',
          before: null,
          after: parent.value.name,
        })
      }

      return card(name, input, {
        target: projectLabel(project.value),
        deepLink: `/projects/${project.value.id}`,
        changes,
        action: {
          kind: 'folder.create',
          projectId: project.value.id,
          name: input.name,
          parentId,
        },
      })
    }

    case FOLDER_RENAME_TOOL: {
      const parsed = parse(proposeFolderRenameSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const project = await findProject(client, input.project)

      if (!project.ok) return fail(project.message)
      const folder = await findFolder(client, project.value.id, input.folder)

      if (!folder.ok) return fail(folder.message)

      return card(name, input, {
        target: projectLabel(project.value),
        deepLink: `/projects/${project.value.id}`,
        changes: [
          { label: 'Folder', before: folder.value.name, after: input.name },
        ],
        action: {
          kind: 'folder.rename',
          projectId: project.value.id,
          folderId: folder.value.id,
          name: input.name,
        },
      })
    }

    case FOLDER_DELETE_TOOL: {
      const parsed = parse(proposeFolderDeleteSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const project = await findProject(client, input.project)

      if (!project.ok) return fail(project.message)
      const folder = await findFolder(client, project.value.id, input.folder)

      if (!folder.ok) return fail(folder.message)

      const inside = await client.list<{ id: string }>(
        'records',
        `?folder_id=eq.${folder.value.id}&deleted_at=is.null&select=id&limit=1`,
      )

      if (inside.length > 0)
        return fail(
          `${folder.value.name} still holds records. Move them out first, or ask where they should go.`,
        )

      return card(name, input, {
        target: projectLabel(project.value),
        deepLink: `/projects/${project.value.id}`,
        changes: [
          { label: 'Folder', before: folder.value.name, after: 'Deleted' },
        ],
        action: {
          kind: 'folder.delete',
          projectId: project.value.id,
          folderId: folder.value.id,
        },
      })
    }

    case FOLDER_MOVE_RECORDS_TOOL: {
      const parsed = parse(proposeFolderMoveRecordsSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const project = await findProject(client, input.project)

      if (!project.ok) return fail(project.message)
      let folder: FolderRow | null = null

      if (input.folder) {
        const found = await findFolder(client, project.value.id, input.folder)

        if (!found.ok) return fail(found.message)
        folder = found.value
      }

      const records: RecordRow[] = []

      for (const wanted of input.records) {
        const found = await findRecord(client, wanted, project.value.id)

        if (!found.ok) return fail(found.message)

        if (!records.some((row) => row.id === found.value.id))
          records.push(found.value)
      }

      return card(name, input, {
        target: projectLabel(project.value),
        deepLink: `/projects/${project.value.id}`,
        changes: records.map((row) => ({
          label: row.identifier,
          before: null,
          after: folder ? folder.name : 'No folder',
        })),
        action: {
          kind: 'folder.move_records',
          projectId: project.value.id,
          recordIds: records.map((row) => row.id),
          folderId: folder?.id ?? null,
        },
      })
    }

    case FOLDER_MOVE_ITEMS_TOOL: {
      const parsed = parse(proposeFolderMoveItemsSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const project = await findProject(client, input.project)

      if (!project.ok) return fail(project.message)
      let folder: FolderRow | null = null

      if (input.folder) {
        const found = await findFolder(client, project.value.id, input.folder)

        if (!found.ok) return fail(found.message)
        folder = found.value
      }

      const items: Array<{
        kind: (typeof input.items)[number]['kind']
        id: string
      }> = []

      const changes: ProposalChange[] = []

      for (const wanted of input.items) {
        const { table, what } = ITEM_TABLES[wanted.kind]

        const rows = await client.list<{ id: string; name: string }>(
          table,
          `?name=ilike.${likeValue(wanted.name)}&select=id,name&order=name.asc&limit=6`,
        )

        const lower = wanted.name.trim().toLowerCase()

        const found = pick(
          rows,
          wanted.name,
          what,
          (row) => row.name,
          (row) => row.name.toLowerCase() === lower,
        )

        if (!found.ok) return fail(found.message)
        items.push({ kind: wanted.kind, id: found.value.id })
        changes.push({
          label: found.value.name,
          before: null,
          after: folder ? folder.name : 'No folder',
        })
      }

      return card(name, input, {
        target: projectLabel(project.value),
        deepLink: `/projects/${project.value.id}`,
        changes,
        action: {
          kind: 'folder.move_items',
          projectId: project.value.id,
          items,
          folderId: folder?.id ?? null,
        },
      })
    }

    case RECORD_FOLLOW_TOOL:
    case RECORD_UNFOLLOW_TOOL: {
      const parsed = parse(proposeRecordFollowSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const follow = name === RECORD_FOLLOW_TOOL
      const record = await findRecord(client, input.record)

      if (!record.ok) return fail(record.message)

      const following = await client.list<{ id: string }>(
        'work_item_follows',
        `?record_id=eq.${record.value.id}&select=id&limit=1`,
      )

      if (follow === following.length > 0)
        return fail(
          follow
            ? `You already follow ${record.value.identifier}.`
            : `You do not follow ${record.value.identifier}.`,
        )

      return card(name, input, {
        target: `${record.value.identifier} ${record.value.title}`,
        deepLink: `/records/${record.value.id}`,
        changes: [
          {
            label: 'Following',
            before: follow ? 'No' : 'Yes',
            after: follow ? 'Yes' : 'No',
          },
        ],
        action: {
          kind: follow ? 'record.follow' : 'record.unfollow',
          recordId: record.value.id,
        },
      })
    }

    case AUDIT_VERIFY_TOOL: {
      const parsed = parse(proposeAuditVerifySchema, args)

      if (!parsed.ok) return fail(parsed.message)

      const last = await client.rpc<{
        ok: boolean
        checkedAt: string
      } | null>('audit_verification_status', {})

      return card(name, parsed.data, {
        target: 'Audit log',
        deepLink: '/settings/workspace/audit',
        changes: [
          {
            label: 'Last check',
            before: last
              ? `${last.checkedAt.slice(0, 10)}, ${last.ok ? 'everything held' : 'something did not hold'}`
              : null,
            after: 'Checked now',
          },
        ],
        action: { kind: 'audit.verify', workspaceId },
      })
    }

    case SQL_LOGIN_REVOKE_TOOL: {
      const parsed = parse(proposeSqlLoginRevokeSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data

      const logins = await client.rpc<
        Array<{ id: string; name: string; username: string; status: string }>
      >('list_sql_logins', { p_workspace_id: workspaceId })

      const lower = input.login.trim().toLowerCase()

      const found = pick(
        logins.filter(
          (row) =>
            row.status !== 'revoked' &&
            (row.name.toLowerCase().includes(lower) ||
              row.username.toLowerCase().includes(lower)),
        ),
        input.login,
        'SQL login',
        (row) => `${row.name} (${row.username})`,
        (row) =>
          row.name.toLowerCase() === lower ||
          row.username.toLowerCase() === lower,
      )

      if (!found.ok) return fail(found.message)

      return card(name, input, {
        target: found.value.name,
        deepLink: '/settings/account/api',
        changes: [
          {
            label: `SQL login ${found.value.username}`,
            before: 'Works',
            after: 'Revoked',
          },
        ],
        action: {
          kind: 'sql_login.revoke',
          workspaceId,
          loginId: found.value.id,
        },
      })
    }
  }
}
