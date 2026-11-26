import type { ProviderToolDef } from '#/lib/ai-providers/types'
import {
  NOTE,
  adminCard,
  fail,
  findClient,
  findMember,
} from '#/lib/assistant-admin-cards.server'
import { invalid, likeValue, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { pick } from '#/lib/assistant-upkeep.server'

import type { FeatureProposalOutcome } from '../define.server'
import {
  CLIENT_ARCHIVE_TOOL,
  CLIENT_MESSAGE_TOOL,
  CLIENT_RENAME_TOOL,
  INVITATION_REISSUE_TOOL,
  MEMBER_USERNAME_TOOL,
  PEOPLE_ADMIN_PROPOSE_TOOL_NAMES,
  SESSION_REVOKE_TOOL,
  proposeClientArchiveSchema,
  proposeClientMessageSchema,
  proposeClientRenameSchema,
  proposeInvitationReissueSchema,
  proposeMemberUsernameSchema,
  proposeSessionRevokeSchema,
} from './cards'
import type { PeopleAdminProposeToolName } from './cards'

/**
 * The people and client cards (see `cards.ts`). Each builder finds what the
 * model named under the signed-in person's own access and returns a card that
 * says exactly what will change. Nothing is written here.
 */

const MEMBERS = '/settings/workspace/members'
const CLIENTS = '/settings/workspace/clients'

export function isPeopleAdminProposalTool(
  name: string,
): name is PeopleAdminProposeToolName {
  return PEOPLE_ADMIN_PROPOSE_TOOL_NAMES.includes(name)
}

export function peopleAdminProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      INVITATION_REISSUE_TOOL,
      `Propose sending an invitation again: a new link for a pending or expired invitation, which stops the old link working. The person gets the link on the card. ${NOTE}`,
      proposeInvitationReissueSchema,
    ),
    toolDef(
      SESSION_REVOKE_TOOL,
      `Propose signing a member out by ending one of their sessions. ${NOTE}`,
      proposeSessionRevokeSchema,
    ),
    toolDef(
      MEMBER_USERNAME_TOOL,
      `Propose giving a member a username, the short name used to mention them. ${NOTE}`,
      proposeMemberUsernameSchema,
    ),
    toolDef(
      CLIENT_RENAME_TOOL,
      `Propose renaming a client. ${NOTE}`,
      proposeClientRenameSchema,
    ),
    toolDef(
      CLIENT_ARCHIVE_TOOL,
      `Propose archiving a client, or bringing an archived one back. ${NOTE}`,
      proposeClientArchiveSchema,
    ),
    toolDef(
      CLIENT_MESSAGE_TOOL,
      `Propose posting a message to a client's portal, optionally about one of their projects. The client sees it. ${NOTE}`,
      proposeClientMessageSchema,
    ),
  ]
}

interface SessionRow {
  id: string
  user_id: string
  user_name: string
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export async function buildPeopleAdminProposal(
  name: PeopleAdminProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; parsed with the tool's schema before any field is read.
  args: unknown,
  context: LabToolContext,
): Promise<FeatureProposalOutcome> {
  const { client, workspaceId } = context

  switch (name) {
    case INVITATION_REISSUE_TOOL: {
      const parsed = proposeInvitationReissueSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const like = likeValue(input.email)

      const rows = await client.list<{
        id: string
        email: string
        status: string
        role: string
      }>(
        'workspace_invitations',
        `?email=ilike.${like}&status=in.(pending,expired)&select=id,email,status,role&order=created_at.desc&limit=6`,
      )

      const lower = input.email.trim().toLowerCase()

      const found = pick(
        rows,
        input.email,
        'pending invitation',
        (row) => row.email,
        (row) => row.email.toLowerCase() === lower,
      )

      if (!found.ok) return fail(found.message)

      return adminCard(input, {
        tool: name,
        target: found.value.email,
        deepLink: MEMBERS,
        changes: [
          {
            label: 'Invitation',
            before: found.value.status,
            after: 'New link',
          },
          {
            label: 'Works for',
            before: null,
            after: `${input.expiresAfterDays} days`,
          },
        ],
        action: {
          kind: 'people_admin.reissue_invitation',
          params: {
            p_workspace_id: workspaceId,
            p_invitation_id: found.value.id,
            p_expires_after_days: input.expiresAfterDays,
          },
          openHref: MEMBERS,
        },
      })
    }

    case SESSION_REVOKE_TOOL: {
      const parsed = proposeSessionRevokeSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const member = await findMember(client, input.person)

      if (!member.ok) return fail(member.message)

      const sessions = (
        await client.rpc<SessionRow[]>('list_workspace_sessions', {
          p_workspace_id: workspaceId,
        })
      ).filter((session) => session.user_id === member.value.user_id)

      if (sessions.length === 0) {
        return fail(`${member.value.name} has no active session.`)
      }

      const device = input.device?.trim().toLowerCase()

      const matching = device
        ? sessions.filter((session) =>
            `${session.ip_address ?? ''} ${session.user_agent ?? ''}`
              .toLowerCase()
              .includes(device),
          )
        : sessions

      const describe = (session: SessionRow): string =>
        `${session.ip_address ?? 'unknown address'}, ${session.user_agent?.slice(0, 40) ?? 'unknown browser'}, since ${session.created_at.slice(0, 10)}`

      if (matching.length !== 1) {
        return fail(
          matching.length === 0
            ? `None of ${member.value.name}'s sessions matches "${input.device}". They have: ${sessions.map(describe).join('; ')}.`
            : `${member.value.name} has ${matching.length} sessions: ${matching.map(describe).join('; ')}. Ask the person which one to end, or pass part of its address or browser as device.`,
        )
      }

      return adminCard(input, {
        tool: name,
        target: member.value.name,
        deepLink: MEMBERS,
        changes: [
          {
            label: member.value.name,
            before: describe(matching[0]),
            after: 'Signed out',
          },
        ],
        action: {
          kind: 'people_admin.revoke_session',
          params: { p_workspace_id: workspaceId, p_session_id: matching[0].id },
          openHref: MEMBERS,
        },
      })
    }

    case MEMBER_USERNAME_TOOL: {
      const parsed = proposeMemberUsernameSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const member = await findMember(client, input.person)

      if (!member.ok) return fail(member.message)

      const current = await client.list<{ username: string | null }>(
        'workspace_memberships',
        `?user_id=eq.${encodeURIComponent(member.value.user_id)}&select=username&limit=1`,
      )

      const username = input.username.toLowerCase()

      return adminCard(input, {
        tool: name,
        target: member.value.name,
        deepLink: MEMBERS,
        changes: [
          {
            label: 'Username',
            before: current.at(0)?.username ?? null,
            after: username,
          },
        ],
        action: {
          kind: 'people_admin.set_username',
          params: {
            p_workspace_id: workspaceId,
            p_user_id: member.value.user_id,
            p_username: username,
          },
          openHref: MEMBERS,
        },
      })
    }

    case CLIENT_RENAME_TOOL: {
      const parsed = proposeClientRenameSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findClient(client, input.client, false)

      if (!found.ok) return fail(found.message)

      return adminCard(input, {
        tool: name,
        target: `${found.value.name} (${found.value.code})`,
        deepLink: CLIENTS,
        changes: [
          { label: 'Name', before: found.value.name, after: input.name.trim() },
        ],
        action: {
          kind: 'people_admin.rename_client',
          params: { p_client_id: found.value.id, p_name: input.name.trim() },
          openHref: CLIENTS,
        },
      })
    }

    case CLIENT_ARCHIVE_TOOL: {
      const parsed = proposeClientArchiveSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findClient(client, input.client, !input.archived)

      if (!found.ok) return fail(found.message)

      return adminCard(input, {
        tool: name,
        target: `${found.value.name} (${found.value.code})`,
        deepLink: CLIENTS,
        changes: [
          {
            label: found.value.name,
            before: input.archived ? 'Active' : 'Archived',
            after: input.archived ? 'Archived' : 'Active',
          },
        ],
        action: {
          kind: 'people_admin.archive_client',
          params: { p_client_id: found.value.id, p_archived: input.archived },
          openHref: CLIENTS,
        },
      })
    }

    case CLIENT_MESSAGE_TOOL: {
      const parsed = proposeClientMessageSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findClient(client, input.client, false)

      if (!found.ok) return fail(found.message)
      let projectId: string | null = null
      let projectTitle: string | null = null

      if (input.project) {
        const like = likeValue(input.project)

        const rows = await client.list<{
          id: string
          title: string
          key: string
          display_id: string | null
        }>(
          'projects',
          `?client_id=eq.${found.value.id}&or=(title.ilike.${like},key.ilike.${like},display_id.ilike.${like})&select=id,title,key,display_id&limit=6`,
        )

        const lower = input.project.trim().toLowerCase()

        const project = pick(
          rows,
          input.project,
          `project of ${found.value.name}`,
          (row) => row.title,
          (row) =>
            row.title.toLowerCase() === lower ||
            row.key.toLowerCase() === lower ||
            row.display_id?.toLowerCase() === lower,
        )

        if (!project.ok) return fail(project.message)
        projectId = project.value.id
        projectTitle = project.value.title
      }

      return adminCard(input, {
        tool: name,
        target: found.value.name,
        deepLink: CLIENTS,
        changes: [
          { label: 'To', before: null, after: found.value.name },
          ...(projectTitle
            ? [{ label: 'About', before: null, after: projectTitle }]
            : []),
          { label: 'Message', before: null, after: input.body.trim() },
        ],
        action: {
          kind: 'people_admin.client_message',
          params: {
            p_client_id: found.value.id,
            p_project_id: projectId,
            p_body: input.body.trim(),
          },
          openHref: CLIENTS,
        },
      })
    }
  }
}
