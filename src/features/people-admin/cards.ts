import { z } from 'zod'

import type { RpcCardAction } from '#/lib/assistant-admin-cards'

/**
 * People and clients from the assistant. Each is a card that says what will
 * change and does nothing until the person presses it. The button calls the
 * ordinary RPC as them, so the members and clients settings rules decide.
 */

export const INVITATION_REISSUE_TOOL = 'sheetbase.invitation.reissue'
export const SESSION_REVOKE_TOOL = 'sheetbase.session.revoke'
export const MEMBER_USERNAME_TOOL = 'sheetbase.member.set_username'
export const CLIENT_RENAME_TOOL = 'sheetbase.client.rename'
export const CLIENT_ARCHIVE_TOOL = 'sheetbase.client.set_archived'
export const CLIENT_MESSAGE_TOOL = 'sheetbase.client.post_message'

export const PEOPLE_ADMIN_PROPOSE_TOOL_NAMES: readonly string[] = [
  INVITATION_REISSUE_TOOL,
  SESSION_REVOKE_TOOL,
  MEMBER_USERNAME_TOOL,
  CLIENT_RENAME_TOOL,
  CLIENT_ARCHIVE_TOOL,
  CLIENT_MESSAGE_TOOL,
]

export type PeopleAdminProposeToolName =
  | typeof INVITATION_REISSUE_TOOL
  | typeof SESSION_REVOKE_TOOL
  | typeof MEMBER_USERNAME_TOOL
  | typeof CLIENT_RENAME_TOOL
  | typeof CLIENT_ARCHIVE_TOOL
  | typeof CLIENT_MESSAGE_TOOL

/** The RPC each card runs. */
export const PEOPLE_ADMIN_RPC = {
  'people_admin.reissue_invitation': 'reissue_invitation',
  'people_admin.revoke_session': 'revoke_user_session',
  'people_admin.set_username': 'set_member_username',
  'people_admin.rename_client': 'rename_client',
  'people_admin.archive_client': 'set_client_archived',
  'people_admin.client_message': 'post_client_portal_message',
} as const

export type PeopleAdminAction = RpcCardAction<keyof typeof PEOPLE_ADMIN_RPC>

const ACTIONS: ReadonlySet<string> = new Set(Object.keys(PEOPLE_ADMIN_RPC))

export function isPeopleAdminAction(action: {
  kind: string
}): action is PeopleAdminAction {
  return ACTIONS.has(action.kind)
}

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

export const proposeInvitationReissueSchema = z.strictObject({
  title,
  summary,
  email: z
    .string()
    .min(3)
    .max(200)
    .describe('The invited person, by email address.'),
  expiresAfterDays: z
    .number()
    .int()
    .min(1)
    .max(90)
    .default(7)
    .describe('How many days the new link works.'),
})

export const proposeSessionRevokeSchema = z.strictObject({
  title,
  summary,
  person: z.string().min(1).max(200).describe('Whose session to end, by name.'),
  device: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Which of their sessions, by part of its IP address or browser, when they have several.',
    ),
})

export const proposeMemberUsernameSchema = z.strictObject({
  title,
  summary,
  person: z.string().min(1).max(200).describe('The member, by name.'),
  username: z
    .string()
    .regex(/^[A-Za-z0-9._-]{3,40}$/)
    .describe('3 to 40 letters, numbers, dots, dashes or underscores.'),
})

export const proposeClientRenameSchema = z.strictObject({
  title,
  summary,
  client: z.string().min(1).max(200).describe('The client, by name or code.'),
  name: z.string().min(1).max(200).describe('Its new name.'),
})

export const proposeClientArchiveSchema = z.strictObject({
  title,
  summary,
  client: z.string().min(1).max(200).describe('The client, by name or code.'),
  archived: z
    .boolean()
    .describe('true to archive the client, false to bring it back.'),
})

export const proposeClientMessageSchema = z.strictObject({
  title,
  summary,
  client: z.string().min(1).max(200).describe('The client, by name or code.'),
  project: z
    .string()
    .max(200)
    .optional()
    .describe('One of that client’s projects, if the message is about it.'),
  body: z.string().min(1).max(4_000).describe('The message.'),
})
