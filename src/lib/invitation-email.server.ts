import { t } from '#/copy'
import { WORKSPACE_ROLE_LABELS, invitationLink } from '#/lib/workspace-admin'

/** The readable name of every workspace role, by the role key the database stores. */
const ROLE_LABELS = new Map<string, string>(
  Object.entries(WORKSPACE_ROLE_LABELS),
)

/** The message that carries an invitation link; the same link the inviter can copy. */
export interface InvitationEmail {
  to: string
  subject: string
  body: string
}

export function composeInvitationEmail(input: {
  origin: string
  token: string
  email: string
  role: string
  workspaceName: string
  inviterName: string | null
}): InvitationEmail {
  const values = {
    inviter: input.inviterName?.trim() || t('settings.members.aColleague'),
    workspace: input.workspaceName,
    role: (ROLE_LABELS.get(input.role) ?? input.role).toLowerCase(),
    link: invitationLink(input.origin, input.token),
  }

  return {
    to: input.email,
    subject: t('settings.members.invitationEmailSubject', values),
    body: t('settings.members.invitationEmailBody', values),
  }
}
