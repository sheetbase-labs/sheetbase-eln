/**
 * Server function behind Settings → Members: email an invitation link when the
 * install can send mail. The invitation itself is made by the database (and the
 * token is returned to the inviter's browser, which keeps the copy-link
 * fallback); this only delivers the same link by email.
 *
 * Server-only modules are imported inside the handler: the settings route
 * imports this file in the client bundle.
 */
import { createServerFn } from '@tanstack/react-start'

export type EmailInvitationResult =
  { sent: true } | { sent: false; reason: 'no_mail_server' | 'send_failed' }

export const emailInvitationFn = createServerFn({ method: 'POST' })
  .validator(
    (input: { workspaceId: string; invitationId: string; token: string }) =>
      input,
  )
  .handler(async ({ data }): Promise<EmailInvitationResult> => {
    const { requireSettingsArea } = await import('#/lib/admin-platform')
    const { userId } = await requireSettingsArea(
      data.workspaceId,
      'members',
      'manage',
    )
    const { env } = await import('#/env.server')
    const { getPool } = await import('#/db/pool.server')
    const { logger } = await import('#/lib/logger')
    const { createSmtpTransport, readSmtpConfig } =
      await import('#/lib/email-delivery.server')
    const { composeInvitationEmail } =
      await import('#/lib/invitation-email.server')

    const config = readSmtpConfig()
    if (!config) return { sent: false, reason: 'no_mail_server' }

    // Only the token's holder may have it mailed: it must match a pending
    // invitation of this workspace, so the endpoint cannot be used to send
    // arbitrary text to arbitrary addresses.
    const pool = getPool(env.DATABASE_URL)
    const { rows } = await pool.query<{
      email: string
      role: string
      workspace_name: string
      inviter_name: string | null
    }>(
      `SELECT i.email, i.role, w.name AS workspace_name,
              (SELECT u.name FROM internal."user" u WHERE u.id = $4) AS inviter_name
         FROM api.workspace_invitations i
         JOIN api.workspaces w ON w.id = i.workspace_id
        WHERE i.id = $1::uuid AND i.workspace_id = $2::uuid
          AND i.status = 'pending' AND i.expires_at > now()
          AND i.token_hash = encode(sha256(convert_to($3, 'UTF8')), 'hex')`,
      [data.invitationId, data.workspaceId, data.token, userId],
    )
    const invitation = rows.at(0)
    if (!invitation) return { sent: false, reason: 'send_failed' }

    const message = composeInvitationEmail({
      origin: env.BETTER_AUTH_URL,
      token: data.token,
      email: invitation.email,
      role: invitation.role,
      workspaceName: invitation.workspace_name,
      inviterName: invitation.inviter_name,
    })
    try {
      await (await createSmtpTransport(config)).send(message)
      return { sent: true }
    } catch (error) {
      logger.warn('invitation email failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      return { sent: false, reason: 'send_failed' }
    }
  })
