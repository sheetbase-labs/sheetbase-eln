import { t } from '#/copy'
import { WORKSPACE_ROLE_LABELS, invitationLink } from '#/lib/workspace-admin'
import type { WorkspaceRole } from '#/lib/workspace-admin'

/** The message that carries an invitation link; the same link the inviter can copy. */
export function composeInvitationEmail(input: {
  origin: string
  token: string
  email: string
  role: string
  workspaceName: string
  inviterName: string | null
}): { to: string; subject: string; body: string } {
  const values = {
    inviter: input.inviterName?.trim() || t('settings.members.aColleague'),
    workspace: input.workspaceName,
    role: (
      (WORKSPACE_ROLE_LABELS[input.role as WorkspaceRole] as
        string | undefined) ?? input.role
    ).toLowerCase(),
    link: invitationLink(input.origin, input.token),
  }
  return {
    to: input.email,
    subject: t('settings.members.invitationEmailSubject', values),
    body: t('settings.members.invitationEmailBody', values),
  }
}
