import { useState } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { authClient } from '#/lib/auth-client'
import { createDataClient } from '#/lib/data-client'
import { setActiveWorkspace } from '#/lib/user-preferences'

export interface AccessBlockedProps {
  user: { name: string; email: string }
  /** The workspace the membership is suspended in, or null when there is none. */
  suspendedWorkspace: { name: string } | null
  /** People who can reinstate the membership. */
  contacts: Array<{ name: string; email: string; role: string }>
  /** Other workspaces the person can still open. */
  otherWorkspaces: Array<{ id: string; name: string }>
  onSwitch: (workspaceId: string) => Promise<void>
  onSignOut: () => Promise<void>
}

/**
 * J-SET-03 and J-SET-04: a signed-in person with no usable workspace. A
 * suspension and a removal are not an outage, so the screen names the cause,
 * who can act, and offers sign-out (and any workspace they can still open).
 */
export function AccessBlockedSurface({
  user,
  suspendedWorkspace,
  contacts,
  otherWorkspaces,
  onSwitch,
  onSignOut,
}: AccessBlockedProps) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch {
      setError(failure)
      setBusy(false)
    }
  }
  return (
    <div className="flex min-h-dvh flex-col items-center bg-surface-muted px-4 pt-[12vh] max-md:pt-8">
      <main
        id="main"
        className="flex w-full max-w-[440px] flex-col gap-4 rounded-lg border border-border bg-surface p-6"
      >
        <div className="flex flex-col gap-1">
          <span className="text-label text-fg-muted">Sheetbase</span>
          <h1 className="text-title">
            {suspendedWorkspace
              ? `Your access to ${suspendedWorkspace.name} is suspended`
              : 'You are not a member of any workspace'}
          </h1>
        </div>
        {suspendedWorkspace ? (
          <>
            <p className="m-0 text-body leading-6 text-fg-muted">
              {user.name} ({user.email}) cannot open records in this workspace
              until an owner reinstates the account. Your records and signatures
              are unchanged.
            </p>
            {contacts.length > 0 ? (
              <div className="flex flex-col gap-1 text-body">
                <span className="font-medium">Contact</span>
                <ul className="m-0 list-none p-0">
                  {contacts.map((c) => (
                    <li key={c.email}>
                      {c.name}
                      {' · '}
                      <a href={`mailto:${c.email}`}>{c.email}</a>
                      <span className="text-fg-muted"> ({c.role})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="m-0 text-body leading-6 text-fg-muted">
                Ask the person who manages your Sheetbase workspace to reinstate
                you.
              </p>
            )}
          </>
        ) : (
          <p className="m-0 text-body leading-6 text-fg-muted">
            {user.name} ({user.email}) has no workspace to open. Either you were
            removed from one, or you have not been added yet. Ask a workspace
            owner to invite you, then open the invitation link they send you.
          </p>
        )}
        {error ? <Notice tone="bad">{error}</Notice> : null}
        {otherWorkspaces.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-body font-medium">
              Open another workspace
            </span>
            {otherWorkspaces.map((w) => (
              <Button
                key={w.id}
                disabled={busy}
                onClick={() =>
                  void run(
                    () => onSwitch(w.id),
                    'Could not switch workspace. Try again.',
                  )
                }
              >
                {w.name}
              </Button>
            ))}
          </div>
        ) : null}
        <Button
          variant={otherWorkspaces.length > 0 ? 'quiet' : 'primary'}
          disabled={busy}
          onClick={() =>
            void run(onSignOut, 'Sign out could not be confirmed. Try again.')
          }
        >
          Sign out
        </Button>
      </main>
    </div>
  )
}

export function AccessBlocked(
  props: Pick<
    AccessBlockedProps,
    'user' | 'suspendedWorkspace' | 'contacts' | 'otherWorkspaces'
  >,
) {
  const router = useRouter()
  const navigate = useNavigate()
  return (
    <AccessBlockedSurface
      {...props}
      onSwitch={async (workspaceId) => {
        await setActiveWorkspace(createDataClient(), workspaceId)
        await router.invalidate()
      }}
      onSignOut={async () => {
        const result = await authClient.signOut()
        if (result.error || !result.data.success) throw new Error('sign out')
        router.options.context.queryClient.clear()
        await navigate({ to: '/sign-in', search: { state: 'signed-out' } })
        await router.invalidate()
      }}
    />
  )
}
