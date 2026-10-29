import { useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { authClient } from '#/lib/auth-client'
import { safeNextPath } from '#/lib/sign-in-redirect'
import { t } from '#/copy'

/**
 * The code prompt after an emailed sign-in link, for an account that turned
 * two-factor on. There is no session yet: Better Auth holds a short-lived
 * challenge cookie, and the session starts only when a code (or a one-time
 * backup code) is accepted. `?next=` is the same validated same-origin path the
 * sign-in screen uses.
 */
export const Route = createFileRoute('/sign-in_/two-factor')({
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    next: safeNextPath(search.next),
  }),
  component: TwoFactorPrompt,
})

export function TwoFactorSurface({
  next,
  verify = defaultVerify,
  onSignedIn = (path: string) => {
    window.location.href = path
  },
}: {
  next?: string
  verify?: (input: { code: string; backup: boolean }) => Promise<string | null>
  onSignedIn?: (path: string) => void
}) {
  const [code, setCode] = useState('')
  const [backup, setBackup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const failure = await verify({ code: code.replace(/\s/g, ''), backup })
    setBusy(false)
    if (failure) {
      setError(failure)
      return
    }
    onSignedIn(safeNextPath(next) ?? '/')
  }

  return (
    <div className="flex min-h-dvh flex-col items-center bg-surface-muted px-4 pt-[12vh] max-md:pt-8">
      <main id="main" className="flex w-full max-w-[400px] flex-col gap-5">
        <form
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 max-md:p-5"
        >
          <div className="flex flex-col gap-1">
            <span className="text-label text-fg-muted">
              {t('settings.signIn.twoFactor.sheetbase')}
            </span>
            <h1 className="text-title max-md:text-[18px] max-md:leading-6">
              {t('settings.signIn.twoFactor.enterCode')}
            </h1>
          </div>
          <p className="m-0 text-body leading-6 text-fg-muted">
            {backup
              ? t('settings.signIn.twoFactor.enterOneBackup')
              : t('settings.signIn.twoFactor.enter6Digit')}
          </p>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <label
            htmlFor="two-factor-code"
            className="flex flex-col gap-1 text-label font-medium"
          >
            {backup
              ? t('settings.signIn.twoFactor.backupCode')
              : '6-digit code'}
            <input
              id="two-factor-code"
              name="code"
              inputMode={backup ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              autoFocus
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="h-9 rounded-md border border-border bg-surface px-3 text-body"
            />
          </label>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={busy || !code.trim()}
          >
            {busy
              ? t('settings.signIn.twoFactor.checking')
              : t('settings.signIn.twoFactor.verifySign')}
          </Button>
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-left text-label text-fg-muted underline"
            onClick={() => {
              setBackup(!backup)
              setCode('')
              setError(null)
            }}
          >
            {backup
              ? t('settings.signIn.twoFactor.useMyAuthenticator')
              : t('settings.signIn.twoFactor.useBackupCode')}
          </button>
          <a className="text-label text-fg-muted" href="/sign-in">
            {t('settings.signIn.twoFactor.startAgain')}
          </a>
        </form>
      </main>
    </div>
  )
}

async function defaultVerify(input: {
  code: string
  backup: boolean
}): Promise<string | null> {
  try {
    const { error } = input.backup
      ? await authClient.twoFactor.verifyBackupCode({ code: input.code })
      : await authClient.twoFactor.verifyTotp({ code: input.code })
    return error
      ? (error.message ?? t('settings.signIn.twoFactor.codeAcceptedTry'))
      : null
  } catch {
    return t('settings.signIn.twoFactor.couldReachSheetbase')
  }
}

function TwoFactorPrompt() {
  const { next } = Route.useSearch()
  return <TwoFactorSurface next={next} />
}
