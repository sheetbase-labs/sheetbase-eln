import { createServerFn } from '@tanstack/react-start'

/**
 * Changing an email address (account basics). Both the person and a workspace
 * administrator ask for a change here; the address only changes when the link
 * sent to the NEW address is opened (`confirmEmailChangeFn`).
 *
 * Server-only modules are imported inside the handlers: the settings routes
 * import this file in the client bundle.
 */

export type EmailChangeRequestResult =
  | { status: 'sent'; email: string }
  | { status: 'link'; email: string; link: string }
  | {
      status: 'refused'
      reason:
        | 'invalid_address'
        | 'same_address'
        | 'address_taken'
        | 'unknown_user'
        | 'no_mail_server'
        | 'send_failed'
    }

export const requestEmailChangeFn = createServerFn({ method: 'POST' })
  .validator(
    (input: { newEmail: string; workspaceId?: string; userId?: string }) =>
      input,
  )
  .handler(async ({ data }): Promise<EmailChangeRequestResult> => {
    const [
      { getRequestHeaders },
      { getCurrentContext },
      { isDevAuthFreeEnabled },
      { env },
      { getPool },
      { logger },
      { createSmtpTransport, readSmtpConfig },
      { createEmailChange, emailChangeLink },
      { t },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('#/lib/current-user'),
      import('#/lib/auth'),
      import('#/env.server'),
      import('#/db/pool.server'),
      import('#/lib/logger'),
      import('#/lib/email-delivery.server'),
      import('#/lib/email-change.server'),
      import('#/copy'),
    ])

    const context = await getCurrentContext(getRequestHeaders())

    if (!context) throw new Error('Your session has ended. Sign in again.')

    // Asking for someone else's change is an administrator's job, in a
    // workspace they both belong to.
    const forAdmin = Boolean(data.userId && data.userId !== context.user.id)
    let targetId = context.user.id

    if (forAdmin) {
      const { requireSettingsArea } = await import('#/lib/admin-platform')
      await requireSettingsArea(data.workspaceId ?? '', 'members', 'manage')
      targetId = data.userId ?? ''
    }

    const pool = getPool(env.DATABASE_URL)

    if (forAdmin) {
      const member = await pool.query(
        `SELECT 1 FROM api.workspace_memberships
          WHERE workspace_id = $1::uuid AND user_id = $2`,
        [data.workspaceId, targetId],
      )

      if (member.rows.length === 0) {
        return { status: 'refused', reason: 'unknown_user' }
      }
    }

    const created = await createEmailChange(pool, {
      userId: targetId,
      newEmail: data.newEmail,
      requestedBy: context.user.id,
    })

    if (!created.ok) return { status: 'refused', reason: created.reason }

    const link = emailChangeLink(env.BETTER_AUTH_URL, created.token)
    const config = readSmtpConfig()

    if (!config) {
      // Without a mail server the link can only be handed over by hand. An
      // administrator may do that; a person asking for their own change only
      // may on a disposable development install, where there is no mailbox.
      if (forAdmin || isDevAuthFreeEnabled()) {
        return { status: 'link', email: created.newEmail, link }
      }

      return { status: 'refused', reason: 'no_mail_server' }
    }

    const name = await pool.query<{ name: string }>(
      `SELECT name FROM internal."user" WHERE id = $1`,
      [targetId],
    )

    try {
      await (
        await createSmtpTransport(config)
      ).send({
        to: created.newEmail,
        subject: t('account.email.requestSubject'),
        body: t('account.email.requestBody', {
          by: forAdmin
            ? t('account.email.yourAdministrator')
            : (name.rows.at(0)?.name ?? t('account.email.you')),
          name: name.rows.at(0)?.name ?? created.oldEmail,
          old: created.oldEmail,
          link,
        }),
      })
    } catch (error) {
      logger.warn('email change link not sent', {
        error: error instanceof Error ? error.message : String(error),
      })

      return { status: 'refused', reason: 'send_failed' }
    }

    return { status: 'sent', email: created.newEmail }
  })

export type EmailChangeConfirmResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'invalid_link' | 'expired' | 'address_taken' }

/** Open the link from the new address. Needs no sign-in: the link is the proof. */
export const confirmEmailChangeFn = createServerFn({ method: 'POST' })
  .validator((input: { token: string }) => input)
  .handler(async ({ data }): Promise<EmailChangeConfirmResult> => {
    const [
      { env },
      { getPool },
      { logger },
      { createSmtpTransport, readSmtpConfig },
      { confirmEmailChange },
      { t },
    ] = await Promise.all([
      import('#/env.server'),
      import('#/db/pool.server'),
      import('#/lib/logger'),
      import('#/lib/email-delivery.server'),
      import('#/lib/email-change.server'),
      import('#/copy'),
    ])

    if (!data.token) return { ok: false, reason: 'invalid_link' }

    const result = await confirmEmailChange(
      getPool(env.DATABASE_URL),
      data.token,
    )

    if (!result.ok) return result
    logger.info('email address changed', { change: 'email' })
    // Tell the old address, so a change nobody expected is noticed.
    const config = readSmtpConfig()

    if (config) {
      try {
        await (
          await createSmtpTransport(config)
        ).send({
          to: result.oldEmail,
          subject: t('account.email.changedSubject'),
          body: t('account.email.changedBody', { new: result.newEmail }),
        })
      } catch (error) {
        logger.warn('old address not told of email change', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return { ok: true, email: result.newEmail }
  })
