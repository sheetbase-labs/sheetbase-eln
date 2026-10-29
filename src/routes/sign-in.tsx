import { useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import { describeSignInError } from '#/lib/auth-errors'
import {
  SignedOutSurface,
  useRetainedDrafts,
} from '#/components/offline/signed-out-surface'
import { Button, buttonVariants } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Icon } from '#/components/v3/icons'
import { cn } from '#/lib/utils'
import { safeNextPath } from '#/lib/sign-in-redirect'
import { useHelp } from '#/lib/help'
import type { ReleaseInfo } from '#/lib/help'
import { rich, t } from '#/copy'

/**
 * UI port (roadmap-4/ui-app3): the redesigned sign-in, outside the app shell
 * like the client portal.
 *
 * R5-SHELL-05 — the product signs in through Better Auth with company OIDC
 * single sign-on, GitHub OAuth, or an emailed one-time link, each shown only
 * when the environment configures it. There is no password sign-in (the
 * Better Auth password HTTP routes are disabled), and no sign-in attempt
 * limit. Two-factor (TOTP) is asked for after an emailed link, on its own
 * page. The only re-authentication path in the product is REV-03's signing
 * password step-up, which is a step-up, not a sign-in. So of the design's
 * five states:
 *
 *   - `signed-out` — supported (the account menu sends the person here).
 *   - `expired-signing` — supported: the signing surface sends the person
 *     here with `next` when its step-up loses the session, and the SSO
 *     callback returns them to the review.
 *   - `password` — deliberately absent: no email/password form exists, and
 *     none is rendered (a dead form is worse than a plain statement). The
 *     emailed link is a one-time link, not a password.
 *   - `sso-only` — company SSO (and GitHub) only, when no email sign-in is
 *     configured.
 *   - `locked` — deliberately absent for sign-in: there is no sign-in attempt
 *     lock. The one lock in the product is the signing-password lock (three
 *     wrong attempts, 15 minutes, self-lifting); it is stated where it
 *     applies — the signing dialog — and enforced server-side.
 *
 * The `?state=` values are the design's QA affordances; each renders a plain
 * statement rather than a control that cannot work. `?next=` is a validated
 * same-origin path the SSO callback returns to. `SignInSurface` is exported
 * for component tests.
 */
export const states = [
  'signed-out',
  'expired-signing',
  'locked',
  'password',
  'sso-only',
] as const
export type SignInState = (typeof states)[number]

const getSignInState = createServerFn({ method: 'GET' }).handler(async () => {
  // Server-only module (reads process env and the DB client); a static import
  // would pull it into the browser bundle, so it is loaded inside the handler.
  const { isDevAuthFreeEnabled, getAuthMethods } = await import('#/lib/auth')
  const methods = getAuthMethods()
  return {
    devAuthFree: isDevAuthFreeEnabled(),
    githubEnabled: methods.github,
    oidcName: methods.oidc?.name ?? null,
    emailLinkEnabled: methods.emailLink,
  }
})

export const Route = createFileRoute('/sign-in')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { state?: SignInState; next?: string; error?: string } => ({
    state: (states as readonly string[]).includes(search.state as string)
      ? (search.state as SignInState)
      : undefined,
    next: safeNextPath(search.next),
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

export interface SignInSurfaceProps {
  state?: SignInState
  next?: string
  /** The raw `?error=` code; mapped to a message the person can act on. */
  error?: string
  devAuthFree: boolean
  githubEnabled: boolean
  /** Display name of the company OIDC provider, or `null` when none is configured. */
  oidcName?: string | null
  /** Whether people can ask for an emailed one-time sign-in link. */
  emailLinkEnabled?: boolean
  release: ReleaseInfo | undefined
  /** EXP-05.5 — drafts this device kept for the person who signed out. */
  retainedDrafts: number
}

export function SignInSurface({
  state,
  next,
  error,
  devAuthFree,
  githubEnabled,
  oidcName = null,
  emailLinkEnabled = false,
  release,
  retainedDrafts,
}: SignInSurfaceProps) {
  const [redirecting, setRedirecting] = useState<'github' | 'oidc' | null>(null)
  const [ssoError, setSsoError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [linkState, setLinkState] = useState<'idle' | 'sending' | 'sent'>(
    'idle',
  )
  const message = describeSignInError(error)

  const title =
    state === 'signed-out'
      ? t('settings.signIn.signedOut')
      : state === 'expired-signing'
        ? t('settings.signIn.signAgainFinish')
        : t('settings.signIn.signInTitle')

  async function sso(method: 'github' | 'oidc') {
    const provider =
      method === 'github' ? 'GitHub' : (oidcName ?? 'your company')
    setRedirecting(method)
    setSsoError(null)
    try {
      const res = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          provider: method,
          // The router already validated `?next=`; the surface validates again
          // so a callback URL can never reach the provider unvalidated.
          callbackURL: safeNextPath(next) ?? '/',
        }),
      })
      const data = (await res.json()) as { url?: string }
      if (data.url) {
        window.location.href = data.url
        return
      }
      setSsoError(t('settings.signIn.didntStart', { provider }))
    } catch {
      setSsoError(t('settings.signIn.couldReachStart', { provider }))
    }
    setRedirecting(null)
  }

  async function sendLink(event: FormEvent) {
    event.preventDefault()
    setLinkState('sending')
    setSsoError(null)
    try {
      const res = await fetch('/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: email.trim(),
          callbackURL: safeNextPath(next) ?? '/',
          errorCallbackURL: '/sign-in',
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setLinkState('sent')
    } catch {
      setSsoError(t('settings.signIn.signLinkCould'))
      setLinkState('idle')
    }
  }

  const anyMethod = githubEnabled || oidcName !== null || emailLinkEnabled

  return (
    <div className="flex min-h-dvh flex-col bg-surface-muted">
      <main
        id="main"
        className="flex flex-1 flex-col items-center px-4 pb-8 pt-[12vh] max-md:pt-8"
      >
        <div className="flex w-full max-w-[400px] flex-col gap-5">
          <div className="flex items-center gap-2 font-heading text-[16px] font-semibold">
            <Mark />
            {t('settings.signIn.sheetbase')}
          </div>
          <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-[0_1px_2px_var(--color-border-subtle)] max-md:p-5">
            <div className="flex flex-col gap-1">
              <span className="text-label text-fg-muted">
                {t('settings.signIn.sheetbase')}
              </span>
              <h1 className="text-title max-md:text-[18px] max-md:leading-6">
                {title}
              </h1>
            </div>

            {ssoError || message ? (
              <Notice tone="bad">{ssoError ?? message}</Notice>
            ) : null}

            {state === 'signed-out' ? (
              <SignedOutSurface retained={retainedDrafts} />
            ) : state === 'expired-signing' ? (
              <Notice tone="warn" title={t('settings.signIn.recordWasnSigned')}>
                {t('settings.signIn.sessionEndedWhile')}
              </Notice>
            ) : state === 'locked' ? (
              <Notice tone="warn" title={t('settings.signIn.nothingUnlock')}>
                {t('settings.signIn.sheetbaseSignsCompany')}
              </Notice>
            ) : state === 'password' ? (
              <Notice
                tone="info"
                title={t('settings.signIn.passwordSignAvailable')}
              >
                {t('settings.signIn.sheetbaseSignsCompany2')}
              </Notice>
            ) : null}

            {devAuthFree ? (
              <div className="flex flex-col gap-2">
                <p className="m-0 text-body leading-6 text-fg-muted">
                  {t('settings.signIn.disposableDevelopmentPreview')}
                </p>
                {/* Open access still needs a way onward: a visitor who lands
                    here by URL has no session to sign in with and no other
                    link into the app. */}
                <a
                  className={cn(
                    buttonVariants({ variant: 'primary', size: 'lg' }),
                    'w-full',
                  )}
                  href={next ?? '/'}
                >
                  {t('settings.signIn.continueSheetbase')}
                </a>
                <p className="m-0 text-center text-label text-fg-muted">
                  {t('settings.signIn.releasedDeploymentsRequire')}
                </p>
              </div>
            ) : anyMethod ? (
              <>
                <div className="flex flex-col gap-2">
                  {oidcName !== null ? (
                    <Button
                      variant="primary"
                      size="lg"
                      className="w-full"
                      disabled={redirecting !== null}
                      onClick={() => void sso('oidc')}
                    >
                      {redirecting === 'oidc' ? (
                        <Icon name="clock" size={16} />
                      ) : null}
                      {redirecting === 'oidc'
                        ? t('settings.signIn.redirecting', { oidcName })
                        : t('settings.signIn.continue', { oidcName })}
                    </Button>
                  ) : null}
                  {githubEnabled ? (
                    <Button
                      variant={oidcName !== null ? 'secondary' : 'primary'}
                      size="lg"
                      className="w-full"
                      disabled={redirecting !== null}
                      onClick={() => void sso('github')}
                    >
                      {redirecting === 'github' ? (
                        <Icon name="clock" size={16} />
                      ) : (
                        <ProviderGlyph />
                      )}
                      {redirecting === 'github'
                        ? t('settings.signIn.redirectingGithub')
                        : t('settings.signIn.continueGithub')}
                    </Button>
                  ) : null}
                  {githubEnabled || oidcName !== null ? (
                    <p className="m-0 text-center text-label text-fg-muted">
                      {t('settings.signIn.useCompanyAccount')}
                    </p>
                  ) : null}
                </div>
                {emailLinkEnabled ? (
                  linkState === 'sent' ? (
                    <Notice tone="info" title={t('settings.signIn.checkEmail')}>
                      {t('settings.signIn.signSheetbaseOne', {
                        email: email.trim(),
                      })}
                    </Notice>
                  ) : (
                    <form
                      className="flex flex-col gap-2 border-t border-border-subtle pt-3"
                      onSubmit={(event) => void sendLink(event)}
                    >
                      <label
                        htmlFor="sign-in-email"
                        className="text-label text-fg-muted"
                      >
                        {t('settings.signIn.signEmailedLink')}
                      </label>
                      <input
                        id="sign-in-email"
                        type="email"
                        name="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="h-9 rounded-md border border-border bg-surface px-3 text-body"
                      />
                      <Button
                        type="submit"
                        variant="secondary"
                        size="lg"
                        className="w-full"
                        disabled={linkState === 'sending' || !email.trim()}
                      >
                        {linkState === 'sending'
                          ? t('settings.signIn.sending')
                          : t('settings.signIn.emailMeSign')}
                      </Button>
                    </form>
                  )
                ) : null}
                <p className="m-0 border-t border-border-subtle pt-3 text-label text-fg-muted">
                  {t('settings.signIn.invitedWorkspaceSign')}
                </p>
              </>
            ) : (
              <p className="text-body leading-6 text-fg-muted">
                {t('settings.signIn.signMethodConfigured')}
              </p>
            )}
          </section>
          <p className="m-0 text-label leading-[18px] text-fg-muted">
            {t('settings.signIn.signingOutEnds')}
          </p>
        </div>
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-border px-4 py-3 text-center text-caption text-fg-muted">
        <span>
          {rich('settings.signIn.releaseLine', {
            version: <span className="mono">{release?.version ?? '—'}</span>,
            label:
              release?.validation.label ??
              t('settings.signIn.developmentBuild'),
          })}
        </span>
        <span aria-hidden="true" className="max-md:hidden">
          ·
        </span>
        {/* An open environment is not an authorised-users-only controlled
            system, so the release statement describes the released product
            only where this deployment actually enforces it. */}
        {devAuthFree ? (
          <span>{t('settings.signIn.openPreviewEnvironment')}</span>
        ) : (
          <>
            <span>
              {release?.statement ??
                '21 CFR Part 11 / EU GMP Annex 11 controlled system'}
            </span>
            <span aria-hidden="true" className="max-md:hidden">
              ·
            </span>
            <span>{t('settings.signIn.authorisedUsersOnly')}</span>
          </>
        )}
      </footer>
    </div>
  )
}

function SignIn() {
  const { devAuthFree, githubEnabled, oidcName, emailLinkEnabled } =
    Route.useLoaderData()
  const { state, next, error } = Route.useSearch()
  const help = useHelp()
  // EXP-05.5: the drafts this device kept when its last user signed out.
  const retainedDrafts = useRetainedDrafts()

  return (
    <SignInSurface
      state={state}
      next={next}
      error={error}
      devAuthFree={devAuthFree}
      githubEnabled={githubEnabled}
      oidcName={oidcName}
      emailLinkEnabled={emailLinkEnabled}
      release={help?.release}
      retainedDrafts={retainedDrafts}
    />
  )
}
