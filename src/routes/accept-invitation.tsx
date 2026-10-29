import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { createDataClient } from '#/lib/data-client'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { setActiveWorkspace } from '#/lib/user-preferences'
import { acceptInvitation, describeAdminError } from '#/lib/workspace-admin'
import { t } from '#/copy'

/**
 * J-SET-01: the redemption path for an invitation. The inviter copies the link
 * from Members and roles; the invitee signs in (the sign-in redirect keeps this
 * URL as `next`), confirms here, and `accept_invitation` creates the membership.
 * The invited workspace then becomes the active one, so they land in it rather
 * than in the personal workspace created at first sign-in.
 */
export const Route = createFileRoute('/accept-invitation')({
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token:
      typeof search.token === 'string' && search.token
        ? search.token
        : undefined,
  }),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) throw redirect(signInRedirect(location))
    return { context }
  },
  component: AcceptInvitation,
})

export function AcceptInvitationSurface({
  token,
  userId,
  userEmail,
  accept,
  onDone,
}: {
  token: string | undefined
  userId: string
  userEmail: string
  accept: (token: string, userId: string) => Promise<void>
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!token) return
    setBusy(true)
    setError(null)
    try {
      await accept(token, userId)
      onDone()
    } catch (err) {
      setError(describeAdminError(err))
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center bg-surface-muted px-4 pt-[12vh] max-md:pt-8">
      <main
        id="main"
        className="flex w-full max-w-[420px] flex-col gap-4 rounded-lg border border-border bg-surface p-6"
      >
        <div className="flex flex-col gap-1">
          <span className="text-label text-fg-muted">
            {t('settings.acceptInvitation.sheetbase')}
          </span>
          <h1 className="text-title">
            {t('settings.acceptInvitation.joinWorkspace')}
          </h1>
        </div>
        {token ? (
          <>
            <p className="m-0 text-body leading-6 text-fg-muted">
              {t('settings.acceptInvitation.signedAcceptingAdds', {
                userEmail,
              })}
            </p>
            {error ? (
              <Notice
                tone="bad"
                title={t('settings.acceptInvitation.invitationAccepted')}
              >
                {t('settings.acceptInvitation.askPersonWho', { error })}
              </Notice>
            ) : null}
            <Button
              variant="primary"
              size="lg"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy
                ? t('settings.acceptInvitation.joining')
                : t('settings.acceptInvitation.acceptInvitation')}
            </Button>
          </>
        ) : (
          <Notice
            tone="warn"
            title={t('settings.acceptInvitation.linkInvitation')}
          >
            {t('settings.acceptInvitation.openFullLink')}
          </Notice>
        )}
      </main>
    </div>
  )
}

function AcceptInvitation() {
  const { token } = Route.useSearch()
  const { context } = Route.useRouteContext()
  const router = useRouter()
  return (
    <AcceptInvitationSurface
      token={token}
      userId={context.user.id}
      userEmail={context.user.email}
      accept={async (inviteToken, userId) => {
        const client = createDataClient()
        const invitation = await acceptInvitation(client, {
          token: inviteToken,
          userId,
        })
        await setActiveWorkspace(client, invitation.workspace_id)
      }}
      onDone={() => {
        void router.invalidate().then(() => router.navigate({ to: '/' }))
      }}
    />
  )
}
