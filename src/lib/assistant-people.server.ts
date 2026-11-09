import {
  ACCESS_DECIDE_TOOL,
  ACCESS_GRANT_TOOL,
  ACCESS_REVOKE_TOOL,
  CLIENT_CREATE_TOOL,
  CLIENT_SHARE_TOOL,
  CLIENT_UNSHARE_TOOL,
  GROUP_CREATE_TOOL,
  GROUP_DELETE_TOOL,
  GROUP_MEMBER_TOOL,
  INVITATION_REVOKE_TOOL,
  MEMBER_INVITE_TOOL,
  MEMBER_REINSTATE_TOOL,
  MEMBER_REMOVE_TOOL,
  MEMBER_ROLE_TOOL,
  MEMBER_SUSPEND_TOOL,
  PEOPLE_PROPOSE_TOOL_NAMES,
  WORKSPACE_GENERAL_TOOL,
  WORKSPACE_RENAME_TOOL,
  proposeAccessDecideSchema,
  proposeAccessGrantSchema,
  proposeAccessRevokeSchema,
  proposeClientCreateSchema,
  proposeClientShareSchema,
  proposeGroupCreateSchema,
  proposeGroupDeleteSchema,
  proposeGroupMemberSchema,
  proposeInvitationRevokeSchema,
  proposeMemberInviteSchema,
  proposeMemberRoleSchema,
  proposeMemberStatusSchema,
  proposeWorkspaceGeneralSchema,
  proposeWorkspaceRenameSchema,
} from './assistant-people'
import type { PeopleAction, PeopleProposeToolName } from './assistant-people'
import { likeValue, toolDef } from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import { parse, pick } from './assistant-upkeep.server'
import type { Lookup } from './assistant-upkeep.server'
import type { AssistantProposal, ProposalChange } from './assistant-proposals'
import type { DataClient } from './data-client'
import { WORKSPACE_ROLE_LABELS } from './workspace-admin'
import type { ProviderToolDef } from './ai-providers/types'

/**
 * Cards for people and the workspace (see `assistant-people.ts`). Each builder
 * finds the person, project, group or client the model named under the
 * signed-in person's own access, and returns a card that says exactly what
 * will change. Nothing is written here; the button calls the ordinary RPC.
 */

export type PeopleOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isPeopleProposalTool(
  name: string,
): name is PeopleProposeToolName {
  return PEOPLE_PROPOSE_TOOL_NAMES.includes(name)
}

export function peopleProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      MEMBER_INVITE_TOOL,
      `Propose inviting someone by email, with their role and the projects they join on accepting. For a client viewer, name the client. The link is shown to the person once it is made. For people who manage members. ${NOTE}`,
      proposeMemberInviteSchema,
    ),
    toolDef(
      INVITATION_REVOKE_TOOL,
      `Propose cancelling an invitation that has not been accepted, by the email it was sent to. ${NOTE}`,
      proposeInvitationRevokeSchema,
    ),
    toolDef(
      MEMBER_ROLE_TOOL,
      `Propose changing a member's role. For people who manage members. ${NOTE}`,
      proposeMemberRoleSchema,
    ),
    toolDef(
      MEMBER_SUSPEND_TOOL,
      `Propose suspending a member, so they cannot sign in until reinstated. Nothing of theirs is deleted. ${NOTE}`,
      proposeMemberStatusSchema,
    ),
    toolDef(
      MEMBER_REINSTATE_TOOL,
      `Propose reinstating a suspended member. ${NOTE}`,
      proposeMemberStatusSchema,
    ),
    toolDef(
      MEMBER_REMOVE_TOOL,
      `Propose removing a member from the workspace. Their work stays on record. Ask first if the person has not clearly said so. ${NOTE}`,
      proposeMemberStatusSchema,
    ),
    toolDef(
      ACCESS_GRANT_TOOL,
      `Propose giving a member access to a project, at a level: owner, editor, reviewer or viewer. ${NOTE}`,
      proposeAccessGrantSchema,
    ),
    toolDef(
      ACCESS_REVOKE_TOOL,
      `Propose taking a member's access to a project away. ${NOTE}`,
      proposeAccessRevokeSchema,
    ),
    toolDef(
      ACCESS_DECIDE_TOOL,
      `Propose approving or declining a request for edit access to a project. Read the access requests area first to see who asked. ${NOTE}`,
      proposeAccessDecideSchema,
    ),
    toolDef(
      GROUP_CREATE_TOOL,
      `Propose making a group of people, which can then be given access to projects. ${NOTE}`,
      proposeGroupCreateSchema,
    ),
    toolDef(
      GROUP_DELETE_TOOL,
      `Propose deleting a group. The access rules that named it go too, and people lose the access they had only through it. Ask first if the person has not clearly said so. ${NOTE}`,
      proposeGroupDeleteSchema,
    ),
    toolDef(
      GROUP_MEMBER_TOOL,
      `Propose adding a member to a group, or taking them out. ${NOTE}`,
      proposeGroupMemberSchema,
    ),
    toolDef(
      WORKSPACE_RENAME_TOOL,
      `Propose renaming the workspace. For people who manage the workspace. ${NOTE}`,
      proposeWorkspaceRenameSchema,
    ),
    toolDef(
      WORKSPACE_GENERAL_TOOL,
      `Propose changing the workspace's site name, time zone, date format or number format. Leave out what should stay as it is. ${NOTE}`,
      proposeWorkspaceGeneralSchema,
    ),
    toolDef(
      CLIENT_CREATE_TOOL,
      `Propose adding a client organisation, whose people can then be invited as client viewers. ${NOTE}`,
      proposeClientCreateSchema,
    ),
    toolDef(
      CLIENT_SHARE_TOOL,
      `Propose showing an approved record to a client in its portal. ${NOTE}`,
      proposeClientShareSchema,
    ),
    toolDef(
      CLIENT_UNSHARE_TOOL,
      `Propose taking a record off a client's portal. ${NOTE}`,
      proposeClientShareSchema,
    ),
  ]
}

const fail = (message: string): PeopleOutcome => ({ ok: false, message })

const roleLabel = (role: string): string =>
  (WORKSPACE_ROLE_LABELS as Record<string, string | undefined>)[role] ?? role

const LEVEL_LABELS: Record<string, string> = {
  owner: 'Owner',
  editor: 'Editor',
  reviewer: 'Reviewer',
  viewer: 'Viewer',
}

function card(
  tool: PeopleProposeToolName,
  input: { title: string; summary: string },
  rest: {
    target: string
    deepLink: string | null
    changes: ProposalChange[]
    action: PeopleAction
  },
): PeopleOutcome {
  return {
    ok: true,
    proposal: { tool, title: input.title, summary: input.summary, ...rest },
  }
}

interface MemberRow {
  user_id: string
  name: string
  role: string
}

async function findMember(
  client: DataClient,
  text: string,
): Promise<Lookup<MemberRow>> {
  const members = await client.rpc<MemberRow[]>('workspace_members_list', {})
  const lower = text.trim().toLowerCase()
  const words = lower.split(/\s+/).filter(Boolean)
  const matches = members.filter((member) =>
    words.every((word) => member.name.toLowerCase().includes(word)),
  )
  return pick(
    matches,
    text,
    'member',
    (row) => row.name,
    (row) => row.name.toLowerCase() === lower || row.user_id === text.trim(),
  )
}

async function findProject(
  client: DataClient,
  text: string,
): Promise<Lookup<{ id: string; title: string }>> {
  const rows = await client.list<{ id: string; title: string }>(
    'projects',
    `?archived_at=is.null&title=ilike.${likeValue(text)}&select=id,title&order=title.asc&limit=6`,
  )
  const lower = text.trim().toLowerCase()
  return pick(
    rows,
    text,
    'project',
    (row) => row.title,
    (row) => row.title.toLowerCase() === lower,
  )
}

interface ClientRow {
  id: string
  code: string
  name: string
}

async function findClient(
  client: DataClient,
  text: string,
): Promise<Lookup<ClientRow>> {
  const like = likeValue(text)
  const rows = await client.list<ClientRow>(
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

async function findRecord(
  client: DataClient,
  text: string,
): Promise<Lookup<{ id: string; identifier: string; title: string }>> {
  const like = likeValue(text)
  const rows = await client.list<{
    id: string
    identifier: string
    title: string
  }>(
    'records',
    `?deleted_at=is.null&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title&order=updated_at.desc&limit=6`,
  )
  const lower = text.trim().toLowerCase()
  return pick(
    rows,
    text,
    'record',
    (row) => `${row.identifier} ${row.title}`,
    (row) =>
      row.identifier.toLowerCase() === lower ||
      row.title.toLowerCase() === lower,
  )
}

async function findGroup(
  client: DataClient,
  text: string,
): Promise<Lookup<{ id: string; name: string }>> {
  const rows = await client.list<{ id: string; name: string }>(
    'workspace_groups',
    `?name=ilike.${likeValue(text)}&select=id,name&order=name.asc&limit=6`,
  )
  const lower = text.trim().toLowerCase()
  return pick(
    rows,
    text,
    'group',
    (row) => row.name,
    (row) => row.name.toLowerCase() === lower,
  )
}

export async function buildPeopleProposal(
  name: PeopleProposeToolName,
  args: unknown,
  context: LabToolContext,
): Promise<PeopleOutcome> {
  const { client, workspaceId } = context
  switch (name) {
    case MEMBER_INVITE_TOOL: {
      const parsed = parse(proposeMemberInviteSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const email = input.email.trim().toLowerCase()
      const isClientViewer = input.clientViewer === true
      const role = isClientViewer ? 'client_viewer' : (input.role ?? 'member')
      let clientId: string | null = null
      let clientName: string | null = null
      if (isClientViewer) {
        if (!input.client) {
          return fail('A client viewer belongs to a client. Ask which one.')
        }
        const found = await findClient(client, input.client)
        if (!found.ok) return fail(found.message)
        clientId = found.value.id
        clientName = found.value.name
      }
      const pending = await client.list<{ id: string }>(
        'workspace_invitations',
        `?email=ilike.${encodeURIComponent(email)}&status=eq.pending&select=id&limit=1`,
      )
      if (pending.length > 0) {
        return fail(
          `${email} already has an invitation waiting. Ask whether to cancel it and send a new one.`,
        )
      }
      const projectGrants: Array<{ project_id: string; access_level: string }> =
        []
      const changes: ProposalChange[] = [
        { label: 'Invite', before: null, after: email },
        { label: 'Role', before: null, after: roleLabel(role) },
      ]
      if (clientName) {
        changes.push({ label: 'Client', before: null, after: clientName })
      }
      for (const wanted of input.projects ?? []) {
        const found = await findProject(client, wanted.project)
        if (!found.ok) return fail(found.message)
        const level = wanted.access ?? 'viewer'
        projectGrants.push({ project_id: found.value.id, access_level: level })
        changes.push({
          label: `Joins ${found.value.title}`,
          before: null,
          after: LEVEL_LABELS[level],
        })
      }
      return card(name, input, {
        target: email,
        deepLink: '/settings/workspace/members',
        changes,
        action: {
          kind: 'member.invite',
          workspaceId,
          email,
          role,
          clientId,
          projectGrants,
        },
      })
    }

    case INVITATION_REVOKE_TOOL: {
      const parsed = parse(proposeInvitationRevokeSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const rows = await client.list<{
        id: string
        email: string
        role: string | null
      }>(
        'workspace_invitations',
        `?email=ilike.${likeValue(input.email)}&status=eq.pending&select=id,email,role&limit=6`,
      )
      const found = pick(
        rows,
        input.email,
        'waiting invitation',
        (row) => row.email,
        (row) => row.email.toLowerCase() === input.email.trim().toLowerCase(),
      )
      if (!found.ok) return fail(found.message)
      return card(name, input, {
        target: found.value.email,
        deepLink: '/settings/workspace/members',
        changes: [
          {
            label: 'Invitation',
            before: `${found.value.email}${found.value.role ? `, ${roleLabel(found.value.role)}` : ''}`,
            after: 'Cancelled',
          },
        ],
        action: {
          kind: 'invitation.revoke',
          workspaceId,
          invitationId: found.value.id,
        },
      })
    }

    case MEMBER_ROLE_TOOL: {
      const parsed = parse(proposeMemberRoleSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const found = await findMember(client, input.member)
      if (!found.ok) return fail(found.message)
      if (found.value.role === input.role) {
        return fail(
          `${found.value.name} is already ${roleLabel(input.role)}. Nothing to change.`,
        )
      }
      return card(name, input, {
        target: found.value.name,
        deepLink: '/settings/workspace/members',
        changes: [
          {
            label: `${found.value.name}'s role`,
            before: roleLabel(found.value.role),
            after: roleLabel(input.role),
          },
        ],
        action: {
          kind: 'member.role',
          workspaceId,
          userId: found.value.user_id,
          role: input.role,
          clientId: null,
        },
      })
    }

    case MEMBER_SUSPEND_TOOL:
    case MEMBER_REINSTATE_TOOL:
    case MEMBER_REMOVE_TOOL: {
      const parsed = parse(proposeMemberStatusSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const found = await findMember(client, input.member)
      if (!found.ok) return fail(found.message)
      if (found.value.user_id === context.userId) {
        return fail(
          'That is the person asking. Ask them to do this to themselves in Settings.',
        )
      }
      const kind =
        name === MEMBER_SUSPEND_TOOL
          ? 'member.suspend'
          : name === MEMBER_REINSTATE_TOOL
            ? 'member.reinstate'
            : 'member.remove'
      const after =
        kind === 'member.suspend'
          ? 'Suspended'
          : kind === 'member.reinstate'
            ? 'Active'
            : 'Removed from the workspace'
      return card(name, input, {
        target: found.value.name,
        deepLink: '/settings/workspace/members',
        changes: [
          {
            label: found.value.name,
            before: roleLabel(found.value.role),
            after,
          },
        ],
        action: { kind, workspaceId, userId: found.value.user_id },
      })
    }

    case ACCESS_GRANT_TOOL: {
      const parsed = parse(proposeAccessGrantSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const member = await findMember(client, input.member)
      if (!member.ok) return fail(member.message)
      const project = await findProject(client, input.project)
      if (!project.ok) return fail(project.message)
      const current = await client.list<{ access_level: string | null }>(
        'project_access',
        `?project_id=eq.${encodeURIComponent(project.value.id)}&user_id=eq.${encodeURIComponent(member.value.user_id)}&select=access_level&limit=1`,
      )
      return card(name, input, {
        target: `${member.value.name} · ${project.value.title}`,
        deepLink: `/projects/${project.value.id}`,
        changes: [
          {
            label: `${member.value.name} on ${project.value.title}`,
            before: current[0]?.access_level
              ? (LEVEL_LABELS[current[0].access_level] ?? null)
              : null,
            after: LEVEL_LABELS[input.access],
          },
        ],
        action: {
          kind: 'access.grant',
          workspaceId,
          projectId: project.value.id,
          userId: member.value.user_id,
          level: input.access,
        },
      })
    }

    case ACCESS_REVOKE_TOOL: {
      const parsed = parse(proposeAccessRevokeSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const member = await findMember(client, input.member)
      if (!member.ok) return fail(member.message)
      const project = await findProject(client, input.project)
      if (!project.ok) return fail(project.message)
      return card(name, input, {
        target: `${member.value.name} · ${project.value.title}`,
        deepLink: `/projects/${project.value.id}`,
        changes: [
          {
            label: `${member.value.name} on ${project.value.title}`,
            before: 'Has access',
            after: 'No access',
          },
        ],
        action: {
          kind: 'access.revoke',
          workspaceId,
          projectId: project.value.id,
          userId: member.value.user_id,
        },
      })
    }

    case ACCESS_DECIDE_TOOL: {
      const parsed = parse(proposeAccessDecideSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const member = await findMember(client, input.member)
      if (!member.ok) return fail(member.message)
      let query = `?status=eq.pending&user_id=eq.${encodeURIComponent(member.value.user_id)}&select=id,project_id,reason&limit=6`
      if (input.project) {
        const project = await findProject(client, input.project)
        if (!project.ok) return fail(project.message)
        query += `&project_id=eq.${encodeURIComponent(project.value.id)}`
      }
      const requests = await client.list<{
        id: string
        project_id: string
        reason: string
      }>('project_access_requests', query)
      if (requests.length === 0) {
        return fail(`${member.value.name} has no request waiting.`)
      }
      if (requests.length > 1) {
        return fail(
          `${member.value.name} has ${requests.length} requests waiting. Ask which project.`,
        )
      }
      const request = requests[0]
      const projects = await client.list<{ title: string }>(
        'projects',
        `?id=eq.${encodeURIComponent(request.project_id)}&select=title&limit=1`,
      )
      const projectTitle = projects[0]?.title ?? 'the project'
      return card(name, input, {
        target: `${member.value.name} · ${projectTitle}`,
        deepLink: `/projects/${request.project_id}`,
        changes: [
          {
            label: `${member.value.name}'s request to edit ${projectTitle}`,
            before: request.reason || 'Waiting',
            after: input.approve ? 'Approved' : 'Declined',
          },
        ],
        action: {
          kind: 'access.decide',
          requestId: request.id,
          approve: input.approve,
          projectId: request.project_id,
        },
      })
    }

    case GROUP_CREATE_TOOL: {
      const parsed = parse(proposeGroupCreateSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const same = await client.list<{ id: string }>(
        'workspace_groups',
        `?name=ilike.${encodeURIComponent(input.name.trim().replaceAll(/[*,()"\\]/g, ' '))}&select=id&limit=1`,
      )
      if (same.length > 0) {
        return fail(
          `There is already a group called "${input.name}". Ask whether they meant that one.`,
        )
      }
      return card(name, input, {
        target: input.name.trim(),
        deepLink: '/settings/workspace/members',
        changes: [{ label: 'Group', before: null, after: input.name.trim() }],
        action: { kind: 'group.create', name: input.name.trim() },
      })
    }

    case GROUP_DELETE_TOOL: {
      const parsed = parse(proposeGroupDeleteSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const group = await findGroup(client, input.group)
      if (!group.ok) return fail(group.message)
      return card(name, input, {
        target: group.value.name,
        deepLink: '/settings/workspace/members',
        changes: [
          {
            label: 'Group',
            before: group.value.name,
            after: 'Deleted, with the access rules that named it',
          },
        ],
        action: { kind: 'group.delete', groupId: group.value.id },
      })
    }

    case GROUP_MEMBER_TOOL: {
      const parsed = parse(proposeGroupMemberSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const group = await findGroup(client, input.group)
      if (!group.ok) return fail(group.message)
      const member = await findMember(client, input.member)
      if (!member.ok) return fail(member.message)
      const add = input.add !== false
      return card(name, input, {
        target: `${member.value.name} · ${group.value.name}`,
        deepLink: '/settings/workspace/members',
        changes: [
          {
            label: group.value.name,
            before: add ? null : member.value.name,
            after: add
              ? `${member.value.name} joins`
              : `${member.value.name} leaves`,
          },
        ],
        action: {
          kind: 'group.member',
          groupId: group.value.id,
          userId: member.value.user_id,
          isMember: add,
        },
      })
    }

    case WORKSPACE_RENAME_TOOL: {
      const parsed = parse(proposeWorkspaceRenameSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const current = await client.list<{ name: string }>(
        'workspaces',
        `?id=eq.${encodeURIComponent(workspaceId)}&select=name&limit=1`,
      )
      return card(name, input, {
        target: input.name.trim(),
        deepLink: '/settings/workspace',
        changes: [
          {
            label: 'Workspace name',
            before: current[0]?.name ?? null,
            after: input.name.trim(),
          },
        ],
        action: {
          kind: 'workspace.rename',
          workspaceId,
          name: input.name.trim(),
        },
      })
    }

    case WORKSPACE_GENERAL_TOOL: {
      const parsed = parse(proposeWorkspaceGeneralSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const current = await client.list<{
        site: string | null
        timezone: string | null
        date_format: string | null
        number_format: string | null
      }>(
        'workspace_settings',
        `?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=site,timezone,date_format,number_format&limit=1`,
      )
      const now = current[0] as (typeof current)[number] | undefined
      const changes: ProposalChange[] = []
      const rows: Array<
        [string, string | undefined, string | null | undefined]
      > = [
        ['Site name', input.site, now?.site],
        ['Time zone', input.timezone, now?.timezone],
        ['Date format', input.dateFormat, now?.date_format],
        ['Number format', input.numberFormat, now?.number_format],
      ]
      for (const [label, next, before] of rows) {
        if (next !== undefined && next !== (before ?? '')) {
          changes.push({
            label,
            before: before ?? null,
            after: next || '(none)',
          })
        }
      }
      if (changes.length === 0) {
        return fail('Nothing would change. Ask what they want to change.')
      }
      return card(name, input, {
        target: 'General settings',
        deepLink: '/settings/workspace',
        changes,
        action: {
          kind: 'workspace.general',
          workspaceId,
          site: input.site ?? now?.site ?? null,
          timezone: input.timezone ?? now?.timezone ?? null,
          dateFormat: input.dateFormat ?? now?.date_format ?? null,
          numberFormat: input.numberFormat ?? now?.number_format ?? null,
        },
      })
    }

    case CLIENT_CREATE_TOOL: {
      const parsed = parse(proposeClientCreateSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const same = await client.list<{ id: string }>(
        'clients',
        `?name=ilike.${encodeURIComponent(input.name.trim().replaceAll(/[*,()"\\]/g, ' '))}&select=id&limit=1`,
      )
      if (same.length > 0) {
        return fail(
          `There is already a client called "${input.name}". Ask whether they meant that one.`,
        )
      }
      return card(name, input, {
        target: input.name.trim(),
        deepLink: '/settings/workspace/clients',
        changes: [{ label: 'Client', before: null, after: input.name.trim() }],
        action: { kind: 'client.create', name: input.name.trim() },
      })
    }

    case CLIENT_SHARE_TOOL:
    case CLIENT_UNSHARE_TOOL: {
      const parsed = parse(proposeClientShareSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const found = await findClient(client, input.client)
      if (!found.ok) return fail(found.message)
      const record = await findRecord(client, input.record)
      if (!record.ok) return fail(record.message)
      const share = name === CLIENT_SHARE_TOOL
      return card(name, input, {
        target: `${record.value.identifier} · ${found.value.name}`,
        deepLink: `/records/${record.value.id}`,
        changes: [
          {
            label: `${record.value.identifier} ${record.value.title}`,
            before: share ? 'Not shared' : `Shown to ${found.value.name}`,
            after: share
              ? `Shown to ${found.value.name} in its portal`
              : 'Taken off the portal',
          },
        ],
        action: {
          kind: 'client.share',
          clientId: found.value.id,
          recordId: record.value.id,
          share,
        },
      })
    }
  }
}
