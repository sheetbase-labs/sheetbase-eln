import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import { describeSignInError } from '#/lib/auth-errors'
import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Icon } from '#/components/v3/icons'
import { useHelp } from '#/lib/help'

/**
 * UI port (roadmap-4/ui-app3): the redesigned sign-in. The ELN signs in with
 * GitHub OAuth through Better Auth (the real provider), not a password store,
 * so the fallback copy states that only company sign-in is available.
 * `?state=` drives the designed states; `?next=` is a validated same-origin
 * path to return to. Outside the app shell, like the client portal.
 */
const states = [
  'signed-out',
  'expired-signing',
  'locked',
  'password',
  'sso-only',
] as const
type SignInState = (typeof states)[number]

const getSignInState = createServerFn({ method: 'GET' }).handler(async () => {
  const { isDevAuthFreeEnabled, isGithubConfigured } =
    await import('#/lib/auth')
  return {
    devAuthFree: isDevAuthFreeEnabled(),
    githubEnabled: isGithubConfigured,
  }
})

export const Route = createFileRoute('/sign-in')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { state?: SignInState; next?: string; error?: string } => ({
    state: (states as readonly string[]).includes(search.state as string)
      ? (search.state as SignInState)
      : undefined,
    next:
      typeof search.next === 'string' && search.next.startsWith('/')
        ? search.next
        : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  loader: () => getSignInState(),
  component: SignIn,
})

function Mark() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="15" height="15" rx="3" />
      <path d="M2.5 8h15M8 8v9.5" />
    </svg>
  )
}

/** GitHub mark drawn in the button's text colour (no brand colours in the product). */
function ProviderGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

function SignIn() {
  const { devAuthFree, githubEnabled } = Route.useLoaderData()
  const { state, next, error } = Route.useSearch()
  const help = useHelp()
  const [redirecting, setRedirecting] = useState(false)
  const message = describeSignInError(error)

  const provider = 'GitHub'
  const title =
    state === 'signed-out'
      ? 'You’re signed out'
      : state === 'expired-signing'
        ? 'Sign in again to finish signing'
        : state === 'locked'
          ? 'This account is locked'
          : 'Sign in to Sheetbase'

  async function sso() {
    setRedirecting(true)
    try {
      const res = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ provider: 'github', callbackURL: next ?? '/' }),
      })
      const data = (await res.json()) as { url?: string }
      if (data.url) {
        window.location.href = data.url
        return
      }
    } catch {
      /* fall through to re-enable the button */
    }
    setRedirecting(false)
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface-muted">
      <main
        id="main"
        className="flex flex-1 flex-col items-center px-4 pb-8 pt-[12vh] max-md:pt-8"
      >
        <div className="flex w-full max-w-[400px] flex-col gap-5">
          <div className="flex items-center gap-2 font-heading text-[16px] font-semibold">
            <Mark />
            Sheetbase
          </div>
          <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-[0_1px_2px_var(--color-border-subtle)] max-md:p-5">
            <div className="flex flex-col gap-1">
              <span className="text-label text-fg-muted">Sheetbase</span>
              <h1 className="text-title max-md:text-[18px] max-md:leading-6">
                {title}
              </h1>
            </div>

            {message ? <Notice tone="bad">{message}</Notice> : null}

            {state === 'signed-out' ? (
              <Notice icon="signOut">
                You signed out of this browser. Saved changes remain in your
                workspace.
              </Notice>
            ) : state === 'expired-signing' ? (
              <Notice tone="warn" title="The record wasn’t signed.">
                Your session ended while the signing dialog was open, so nothing
                was recorded. Sign in and you’ll go back to the review to sign
                again.
              </Notice>
            ) : null}

            {state === 'locked' ? (
              <>
                <Notice tone="bad" icon="lock">
                  Too many unsuccessful sign-in attempts. The account stays
                  locked until an administrator unlocks it.
                </Notice>
                <div className="flex flex-col gap-1 text-body leading-5">
                  <p className="m-0">
                    Contact your workspace admin or the IT service desk. Give
                    them this reference:
                  </p>
                  <p className="m-0">
                    <span className="mono rounded-sm bg-surface-muted px-1.5 py-0.5 text-label">
                      LCK-0000-0000
                    </span>
                  </p>
                  <p className="m-0 text-label text-fg-muted">
                    If this wasn’t you trying to sign in, tell them. Every
                    attempt is recorded with its time and network address.
                  </p>
                </div>
                <Button
                  size="lg"
                  nativeButton={false}
                  render={<Link to="/sign-in" />}
                >
                  Use a different account
                </Button>
              </>
            ) : devAuthFree ? (
              <p className="text-body leading-6 text-fg-muted">
                This disposable development or preview environment is open for
                review. No sign-in or OAuth setup is required.
              </p>
            ) : githubEnabled ? (
              <>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="primary"
                    size="lg"
                    className="w-full"
                    disabled={redirecting}
                    onClick={() => void sso()}
                  >
                    {redirecting ? (
                      <Icon name="clock" size={16} />
                    ) : (
                      <ProviderGlyph />
                    )}
                    {redirecting
                      ? `Redirecting to ${provider}…`
                      : `Continue with ${provider}`}
                  </Button>
                  <p className="m-0 text-center text-label text-fg-muted">
                    Use your company account.
                  </p>
                </div>
                <p className="m-0 border-t border-border-subtle pt-3 text-label text-fg-muted">
                  Sheetbase only allows company sign-in. If you don’t have a
                  company account, ask your workspace admin.
                </p>
              </>
            ) : (
              <p className="text-body leading-6 text-fg-muted">
                GitHub sign-in is not configured for this environment yet. See
                docs/operations/authentication.md to create the OAuth
                application and set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.
              </p>
            )}
          </section>
          <p className="m-0 text-label leading-[18px] text-fg-muted">
            Signing out ends this browser session. Signing a record always asks
            for your password again.
          </p>
        </div>
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-border px-4 py-3 text-center text-caption text-fg-muted">
        <span>
          Sheetbase <span className="mono">{help?.release.version ?? '—'}</span>{' '}
          · {help?.release.validation.label ?? 'Development build'} release
        </span>
        <span aria-hidden="true" className="max-md:hidden">
          ·
        </span>
        <span>
          {help?.release.statement ??
            '21 CFR Part 11 / EU GMP Annex 11 controlled system'}
        </span>
        <span aria-hidden="true" className="max-md:hidden">
          ·
        </span>
        <span>Authorised users only; activity is recorded</span>
      </footer>
    </div>
  )
}
