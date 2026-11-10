import { LabLogo } from '#/components/ui/lab-logo'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { parseSignInSearch } from './-sign-in-search'
import type { SignInState } from './-sign-in-search'

import { describeSignInError } from '#/lib/auth-errors'
import {
  SignedOutSurface,
  useRetainedDrafts,
} from '#/components/offline/signed-out-surface'
import { Button, buttonVariants } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Icon } from '#/components/icons'
import { usePasskeysSupported } from '#/components/settings/settings-passkeys'
import { authClient } from '#/lib/auth-client'
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
const getSignInState = createServerFn({ method: 'GET' }).handler(async () => {
  // Server-only module (reads process env and the DB client); a static import
  // would pull it into the browser bundle, so it is loaded inside the handler.
  const { isDevAuthFreeEnabled, getAuthMethods } = await import('#/lib/auth')
  const methods = getAuthMethods()

  return {
    devAuthFree: isDevAuthFreeEnabled(),
    githubEnabled: methods.github,
    oidcName: methods.oidc?.name ?? null,
    samlName: methods.saml?.name ?? null,
    emailLinkEnabled: methods.emailLink,
  }
})

export const Route = createFileRoute('/sign-in')({
  validateSearch: parseSignInSearch,
  loader: () => getSignInState(),
  component: SignIn,
})

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
  /** Display name of the company SAML provider, or `null` when none is configured. */
  samlName?: string | null
  /** Whether people can ask for an emailed one-time sign-in link. */
  emailLinkEnabled?: boolean
  release: ReleaseInfo | undefined
  /** EXP-05.5 — drafts this device kept for the person who signed out. */
  retainedDrafts: number
}

function useSignInActions({
  next,
  oidcName,
  samlName,
}: Pick<SignInSurfaceProps, 'next' | 'oidcName' | 'samlName'>) {
  const [redirecting, setRedirecting] = useState<
    'github' | 'oidc' | 'saml' | null
  >(null)

  const [ssoError, setSsoError] = useState<string | null>(null)
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const passkeysSupported = usePasskeysSupported()
  const [email, setEmail] = useState('')

  const [linkState, setLinkState] = useState<'idle' | 'sending' | 'sent'>(
    'idle',
  )

  async function sso(method: 'github' | 'oidc' | 'saml') {
    const provider =
      method === 'github'
        ? 'GitHub'
        : ((method === 'saml' ? samlName : oidcName) ?? 'your company')

    setRedirecting(method)
    setSsoError(null)

    try {
      // The router already validated `?next=`; the surface validates again
      // so a callback URL can never reach the provider unvalidated.
      const callbackURL = safeNextPath(next) ?? '/'

      const res =
        method === 'saml'
          ? await fetch('/api/auth/sign-in/sso', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({
                providerId: 'saml',
                callbackURL,
                errorCallbackURL: '/sign-in',
              }),
            })
          : await fetch('/api/auth/sign-in/social', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({ provider: method, callbackURL }),
            })

      const data = z
        .object({ url: z.string().optional() })
        .parse(await res.json())

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

  async function signInWithPasskey() {
    setPasskeyBusy(true)
    setSsoError(null)

    try {
      const { error: failure } = await authClient.signIn.passkey()

      if (failure) {
        setSsoError(t('people.passkeys.signInFailed'))

        return
      }

      window.location.href = safeNextPath(next) ?? '/'
    } catch {
      setSsoError(t('people.passkeys.signInFailed'))
    } finally {
      setPasskeyBusy(false)
    }
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

  return {
    redirecting,
    ssoError,
    passkeyBusy,
    passkeysSupported,
    email,
    setEmail,
    linkState,
    sso,
    signInWithPasskey,
    sendLink,
  }
}

export function SignInSurface({
  state,
  next,
  error,
  devAuthFree,
  githubEnabled,
  oidcName = null,
  samlName = null,
  emailLinkEnabled = false,
  release,
  retainedDrafts,
}: SignInSurfaceProps) {
  const actions = useSignInActions({ next, oidcName, samlName })
  const message = describeSignInError(error)

  const title =
    state === 'signed-out'
      ? t('settings.signIn.signedOut')
      : state === 'expired-signing'
        ? t('settings.signIn.signAgainFinish')
        : t('settings.signIn.signInTitle')

  const anyMethod =
    githubEnabled || oidcName !== null || samlName !== null || emailLinkEnabled

  return (
    <div className="flex min-h-dvh flex-col bg-surface-muted">
      <main
        id="main"
        className="flex flex-1 flex-col items-center px-4 pb-8 pt-[12vh] max-md:pt-8"
      >
        <div className="flex w-full max-w-[400px] flex-col gap-5">
          <div className="flex items-center gap-2 font-heading text-[16px] font-semibold">
            <LabLogo height={26} />
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

            {actions.ssoError || message ? (
              <Notice tone="bad">{actions.ssoError ?? message}</Notice>
            ) : null}

            <SignInStateNotice state={state} retainedDrafts={retainedDrafts} />

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
                <ProviderButtons
                  oidcName={oidcName}
                  samlName={samlName}
                  githubEnabled={githubEnabled}
                  actions={actions}
                />
                {emailLinkEnabled ? <EmailLinkForm actions={actions} /> : null}
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
      <SignInRelease release={release} devAuthFree={devAuthFree} />
    </div>
  )
}

function SignInRelease({
  release,
  devAuthFree,
}: Pick<SignInSurfaceProps, 'release' | 'devAuthFree'>) {
  return (
    <footer className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-border px-4 py-3 text-center text-caption text-fg-muted">
      <span>
        {rich('settings.signIn.releaseLine', {
          version: <span className="mono">{release?.version ?? '—'}</span>,
          label:
            release?.validation.label ?? t('settings.signIn.developmentBuild'),
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
  )
}

function ProviderButtons({
  oidcName,
  samlName,
  githubEnabled,
  actions,
}: {
  oidcName: string | null
  samlName: string | null
  githubEnabled: boolean
  actions: ReturnType<typeof useSignInActions>
}) {
  const providers: {
    method: NonNullable<typeof actions.redirecting>
    name: string
  }[] = []

  if (oidcName !== null) providers.push({ method: 'oidc', name: oidcName })

  if (samlName !== null) providers.push({ method: 'saml', name: samlName })

  if (githubEnabled) providers.push({ method: 'github', name: 'GitHub' })

  return (
    <div className="flex flex-col gap-2">
      {providers.map(({ method, name }, index) => (
        <Button
          key={method}
          variant={index === 0 ? 'primary' : 'secondary'}
          size="lg"
          className="w-full"
          disabled={actions.redirecting !== null}
          onClick={() => void actions.sso(method)}
        >
          {actions.redirecting === method ? (
            <Icon name="clock" size={16} />
          ) : method === 'github' ? (
            <ProviderGlyph />
          ) : null}
          {method === 'github'
            ? t(
                actions.redirecting === method
                  ? 'settings.signIn.redirectingGithub'
                  : 'settings.signIn.continueGithub',
              )
            : t(
                actions.redirecting === method
                  ? 'settings.signIn.redirecting'
                  : 'settings.signIn.continue',
                { oidcName: name },
              )}
        </Button>
      ))}
      {providers.length > 0 ? (
        <p className="m-0 text-center text-label text-fg-muted">
          {t('settings.signIn.useCompanyAccount')}
        </p>
      ) : null}
      {actions.passkeysSupported ? (
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          disabled={actions.redirecting !== null || actions.passkeyBusy}
          onClick={() => void actions.signInWithPasskey()}
        >
          <Icon name="key" size={16} />
          {actions.passkeyBusy
            ? t('people.passkeys.signingIn')
            : t('people.passkeys.signIn')}
        </Button>
      ) : null}
    </div>
  )
}

function EmailLinkForm({
  actions,
}: {
  actions: ReturnType<typeof useSignInActions>
}) {
  if (actions.linkState === 'sent')
    return (
      <Notice tone="info" title={t('settings.signIn.checkEmail')}>
        {t('settings.signIn.signSheetbaseOne', { email: actions.email.trim() })}
      </Notice>
    )

  return (
    <form
      className="flex flex-col gap-2 border-t border-border-subtle pt-3"
      onSubmit={(event) => void actions.sendLink(event)}
    >
      <label htmlFor="sign-in-email" className="text-label text-fg-muted">
        {t('settings.signIn.signEmailedLink')}
      </label>
      <input
        id="sign-in-email"
        type="email"
        name="email"
        autoComplete="email"
        required
        value={actions.email}
        onChange={(event) => actions.setEmail(event.target.value)}
        className="h-9 rounded-md border border-border bg-surface px-3 text-body"
      />
      <Button
        type="submit"
        variant="secondary"
        size="lg"
        className="w-full"
        disabled={actions.linkState === 'sending' || !actions.email.trim()}
      >
        {actions.linkState === 'sending'
          ? t('settings.signIn.sending')
          : t('settings.signIn.emailMeSign')}
      </Button>
    </form>
  )
}

function SignInStateNotice({
  state,
  retainedDrafts,
}: Pick<SignInSurfaceProps, 'state' | 'retainedDrafts'>) {
  switch (state) {
    case 'signed-out':
      return <SignedOutSurface retained={retainedDrafts} />
    case 'expired-signing':
      return (
        <Notice tone="warn" title={t('settings.signIn.recordWasnSigned')}>
          {t('settings.signIn.sessionEndedWhile')}
        </Notice>
      )
    case 'locked':
      return (
        <Notice tone="warn" title={t('settings.signIn.nothingUnlock')}>
          {t('settings.signIn.sheetbaseSignsCompany')}
        </Notice>
      )
    case 'password':
      return (
        <Notice tone="info" title={t('settings.signIn.passwordSignAvailable')}>
          {t('settings.signIn.sheetbaseSignsCompany2')}
        </Notice>
      )
    default:
      return null
  }
}

function SignIn() {
  const { devAuthFree, githubEnabled, oidcName, samlName, emailLinkEnabled } =
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
      samlName={samlName}
      emailLinkEnabled={emailLinkEnabled}
      release={help?.release}
      retainedDrafts={retainedDrafts}
    />
  )
}
