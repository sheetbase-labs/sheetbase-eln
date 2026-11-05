import { useEffect, useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

import { LabLogo } from '#/components/ui/lab-logo'
import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { confirmEmailChangeFn } from '#/components/settings/settings-email-data'
import type { EmailChangeConfirmResult } from '#/components/settings/settings-email-data'
import { t } from '#/copy'

/**
 * The link sent to a NEW email address. Opening it is the proof the person
 * controls that address, so it needs no sign-in: it changes the address and
 * ends the old sign-ins.
 */
export const Route = createFileRoute('/confirm-email-change')({
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token:
      typeof search.token === 'string' && search.token
        ? search.token
        : undefined,
  }),
  component: ConfirmEmailChange,
})

export function ConfirmEmailChangeSurface({
  result,
}: {
  result: EmailChangeConfirmResult | null
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center bg-surface-muted px-4 pt-[12vh] max-md:pt-8">
      <main
        id="main"
        className="flex w-full max-w-[420px] flex-col gap-4 rounded-lg border border-border bg-surface p-6"
      >
        <div className="flex flex-col gap-1">
          <LabLogo height={26} className="mb-2 text-fg" />
          <h1 className="text-title">
            {result === null
              ? t('account.email.title')
              : result.ok
                ? t('account.email.confirmedTitle')
                : result.reason === 'expired'
                  ? t('account.email.expiredTitle')
                  : result.reason === 'address_taken'
                    ? t('account.email.takenTitle')
                    : t('account.email.invalidTitle')}
          </h1>
        </div>
        {result === null ? (
          <p className="m-0 text-body text-fg-muted">
            {t('account.email.confirming')}
          </p>
        ) : result.ok ? (
          <>
            <p className="m-0 text-body leading-6 text-fg-muted">
              {t('account.email.confirmedBody', { email: result.email })}
            </p>
            <Button
              variant="primary"
              size="lg"
              nativeButton={false}
              render={<Link to="/sign-in" />}
            >
              {t('account.email.signIn')}
            </Button>
          </>
        ) : (
          <Notice tone="warn">
            {result.reason === 'expired'
              ? t('account.email.expiredBody')
              : result.reason === 'address_taken'
                ? t('account.email.takenBody')
                : t('account.email.invalidBody')}
          </Notice>
        )}
      </main>
    </div>
  )
}

function ConfirmEmailChange() {
  const { token } = Route.useSearch()
  const [result, setResult] = useState<EmailChangeConfirmResult | null>(
    token ? null : { ok: false, reason: 'invalid_link' },
  )
  // A link is single use, so confirm once however often the page renders.
  const started = useRef(false)
  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    confirmEmailChangeFn({ data: { token } })
      .then(setResult)
      .catch(() => setResult({ ok: false, reason: 'invalid_link' }))
  }, [token])
  return <ConfirmEmailChangeSurface result={result} />
}
