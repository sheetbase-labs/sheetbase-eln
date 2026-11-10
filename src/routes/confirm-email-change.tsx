import { useEffect, useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

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
/** The link's search: the token it proves control of the address with. */
const confirmSearch = z.object({
  token: z.string().min(1).optional().catch(undefined),
})

export const Route = createFileRoute('/confirm-email-change')({
  validateSearch: (search) => confirmSearch.parse(search),
  component: ConfirmEmailChange,
})

/** The headline for what the link did, or that it is still being checked. */
function surfaceTitle(result: EmailChangeConfirmResult | null): string {
  if (result === null) return t('account.email.title')

  if (result.ok) return t('account.email.confirmedTitle')

  if (result.reason === 'expired') return t('account.email.expiredTitle')

  if (result.reason === 'address_taken') return t('account.email.takenTitle')

  return t('account.email.invalidTitle')
}

/** Why the link was refused, in the words the person can act on. */
function refusalBody(reason: string): string {
  if (reason === 'expired') return t('account.email.expiredBody')

  if (reason === 'address_taken') return t('account.email.takenBody')

  return t('account.email.invalidBody')
}

/** What the link did, said under the headline. */
function Outcome({ result }: { result: EmailChangeConfirmResult | null }) {
  if (result === null) {
    return (
      <p className="m-0 text-body text-fg-muted">
        {t('account.email.confirming')}
      </p>
    )
  }

  if (!result.ok) {
    return <Notice tone="warn">{refusalBody(result.reason)}</Notice>
  }

  return (
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
  )
}

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
          <h1 className="text-title">{surfaceTitle(result)}</h1>
        </div>
        <Outcome result={result} />
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
