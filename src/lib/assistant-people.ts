import { z } from 'zod'

import { PEOPLE_OPERATIONS } from './operations/declarations/people'
import { assistantToolsFrom } from './operations/descriptor'

/**
 * People and the workspace from the assistant: invite someone, change a role,
 * suspend or remove a member, give someone access to a project, decide a
 * request for access, make a group, add a client and share a record with its
 * portal, rename the workspace or change its general settings.
 *
 * Like the other cards, the model names people, projects and clients the way
 * the lab does, the server finds them and sends back a card, and nothing
 * happens until the person presses the button. The button calls the ordinary
 * RPC as the signed-in person, so what they may do is the page's own rule.
 * An invitation's link is shown to the person on the card once it is made.
 */

export const MEMBER_INVITE_TOOL = 'sheetbase.member.invite'
export const INVITATION_REVOKE_TOOL = 'sheetbase.invitation.revoke'
export const MEMBER_ROLE_TOOL = 'sheetbase.member.set_role'
export const MEMBER_SUSPEND_TOOL = 'sheetbase.member.suspend'
export const MEMBER_REINSTATE_TOOL = 'sheetbase.member.reinstate'
export const MEMBER_REMOVE_TOOL = 'sheetbase.member.remove'
export const ACCESS_GRANT_TOOL = 'sheetbase.project_access.grant'
export const ACCESS_REVOKE_TOOL = 'sheetbase.project_access.revoke'
export const ACCESS_DECIDE_TOOL = 'sheetbase.project_access.decide'
export const GROUP_CREATE_TOOL = 'sheetbase.group.create'
export const GROUP_DELETE_TOOL = 'sheetbase.group.delete'
export const GROUP_MEMBER_TOOL = 'sheetbase.group.set_member'
export const WORKSPACE_RENAME_TOOL = 'sheetbase.workspace.rename'
export const WORKSPACE_GENERAL_TOOL = 'sheetbase.workspace.general'
export const CLIENT_CREATE_TOOL = 'sheetbase.client.create'
export const CLIENT_SHARE_TOOL = 'sheetbase.client.share_record'
export const CLIENT_UNSHARE_TOOL = 'sheetbase.client.unshare_record'

/** The tool names come from the operation declarations, so they cannot drift. */
export const PEOPLE_PROPOSE_TOOL_NAMES = assistantToolsFrom(
  PEOPLE_OPERATIONS,
  'propose',
) as readonly string[]

export type PeopleProposeToolName =
  | typeof MEMBER_INVITE_TOOL
  | typeof INVITATION_REVOKE_TOOL
  | typeof MEMBER_ROLE_TOOL
  | typeof MEMBER_SUSPEND_TOOL
  | typeof MEMBER_REINSTATE_TOOL
  | typeof MEMBER_REMOVE_TOOL
  | typeof ACCESS_GRANT_TOOL
  | typeof ACCESS_REVOKE_TOOL
  | typeof ACCESS_DECIDE_TOOL
  | typeof GROUP_CREATE_TOOL
  | typeof GROUP_DELETE_TOOL
  | typeof GROUP_MEMBER_TOOL
  | typeof WORKSPACE_RENAME_TOOL
  | typeof WORKSPACE_GENERAL_TOOL
  | typeof CLIENT_CREATE_TOOL
  | typeof CLIENT_SHARE_TOOL
  | typeof CLIENT_UNSHARE_TOOL

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)
const person = z
  .string()
  .min(1)
  .max(200)
  .describe('The person, by the name people use for them.')
const projectRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The project, by name or key.')
const role = z.enum([
  'owner',
  'admin',
  'member',
  'steward',
  'scientist',
  'analyst',
  'reviewer',
  'viewer',
])
const accessLevel = z.enum(['owner', 'editor', 'reviewer', 'viewer'])

export const proposeMemberInviteSchema = z
  .object({
    title,
    summary,
    email: z.string().email().max(320),
    role: role.optional().describe('Their role. Default member.'),
    projects: z
      .array(
        z
          .object({ project: projectRef, access: accessLevel.optional() })
          .strict(),
      )
      .max(20)
      .optional()
      .describe('Projects they join on accepting, with the access they get.'),
    client: z
      .string()
      .max(200)
      .optional()
      .describe('For a client viewer: the client, by name or code.'),
    clientViewer: z
      .boolean()
      .optional()
      .describe('true to invite them as a client viewer (needs `client`).'),
  })
  .strict()

export const proposeInvitationRevokeSchema = z
  .object({
    title,
    summary,
    email: z.string().min(1).max(320).describe('The email it was sent to.'),
  })
  .strict()

export const proposeMemberRoleSchema = z
  .object({ title, summary, member: person, role })
  .strict()

export const proposeMemberStatusSchema = z
  .object({ title, summary, member: person })
  .strict()

export const proposeAccessGrantSchema = z
  .object({
    title,
    summary,
    member: person,
    project: projectRef,
    access: accessLevel.describe(
      'owner manages and edits, editor edits, reviewer reviews, viewer reads.',
    ),
  })
  .strict()

export const proposeAccessRevokeSchema = z
  .object({ title, summary, member: person, project: projectRef })
  .strict()

export const proposeAccessDecideSchema = z
  .object({
    title,
    summary,
    member: person.describe('Who asked for edit access.'),
    project: projectRef.optional(),
    approve: z.boolean(),
  })
  .strict()

export const proposeGroupCreateSchema = z
  .object({
    title,
    summary,
    name: z.string().min(1).max(120).describe('The group’s name.'),
  })
  .strict()

export const proposeGroupDeleteSchema = z
  .object({ title, summary, group: z.string().min(1).max(120) })
  .strict()

export const proposeGroupMemberSchema = z
  .object({
    title,
    summary,
    group: z.string().min(1).max(120),
    member: person,
    add: z
      .boolean()
      .optional()
      .describe('false to take them out. Default true.'),
  })
  .strict()

export const proposeWorkspaceRenameSchema = z
  .object({ title, summary, name: z.string().min(1).max(120) })
  .strict()

export const proposeWorkspaceGeneralSchema = z
  .object({
    title,
    summary,
    site: z.string().max(120).optional(),
    timezone: z
      .string()
      .max(80)
      .optional()
      .describe('IANA zone, Europe/London.'),
    dateFormat: z
      .enum(['d MMM yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd'])
      .optional()
      .describe('d MMM yyyy (25 Sep 2026), dd/MM/yyyy or yyyy-MM-dd.'),
    numberFormat: z.enum(['decimal', 'scientific']).optional(),
  })
  .strict()

export const proposeClientCreateSchema = z
  .object({
    title,
    summary,
    name: z
      .string()
      .min(1)
      .max(200)
      .describe('The client organisation’s name.'),
  })
  .strict()

export const proposeClientShareSchema = z
  .object({
    title,
    summary,
    client: z.string().min(1).max(200).describe('The client, by name or code.'),
    record: z
      .string()
      .min(1)
      .max(200)
      .describe('The approved record, by identifier (EXP-12) or title.'),
  })
  .strict()

/** What a people card does when its button is pressed. */
export type PeopleAction =
  | {
      kind: 'member.invite'
      workspaceId: string
      email: string
      role: string
      clientId: string | null
      projectGrants: Array<{ project_id: string; access_level: string }>
    }
  | { kind: 'invitation.revoke'; workspaceId: string; invitationId: string }
  | {
      kind: 'member.role'
      workspaceId: string
      userId: string
      role: string
      clientId: string | null
    }
  | { kind: 'member.suspend'; workspaceId: string; userId: string }
  | { kind: 'member.reinstate'; workspaceId: string; userId: string }
  | { kind: 'member.remove'; workspaceId: string; userId: string }
  | {
      kind: 'access.grant'
      workspaceId: string
      projectId: string
      userId: string
      level: string
    }
  | {
      kind: 'access.revoke'
      workspaceId: string
      projectId: string
      userId: string
    }
  | {
      kind: 'access.decide'
      requestId: string
      approve: boolean
      projectId: string
    }
  | { kind: 'group.create'; name: string }
  | { kind: 'group.delete'; groupId: string }
  | { kind: 'group.member'; groupId: string; userId: string; isMember: boolean }
  | { kind: 'workspace.rename'; workspaceId: string; name: string }
  | {
      kind: 'workspace.general'
      workspaceId: string
      site: string | null
      timezone: string | null
      dateFormat: string | null
      numberFormat: string | null
    }
  | { kind: 'client.create'; name: string }
  | { kind: 'client.share'; clientId: string; recordId: string; share: boolean }

export type PeopleActionKind = PeopleAction['kind']

const KINDS: readonly string[] = [
  'member.invite',
  'invitation.revoke',
  'member.role',
  'member.suspend',
  'member.reinstate',
  'member.remove',
  'access.grant',
  'access.revoke',
  'access.decide',
  'group.create',
  'group.delete',
  'group.member',
  'workspace.rename',
  'workspace.general',
  'client.create',
  'client.share',
]

export function isPeopleAction(action: {
  kind: string
}): action is PeopleAction {
  return KINDS.includes(action.kind)
}

/** What running a card gave back, for the card to link to. */
export interface PeopleActionResult {
  openHref?: string
  /** The link of a new invitation, for the person to send. */
  note?: string
}
