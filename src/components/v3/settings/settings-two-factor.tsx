import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Field, Input } from '#/components/v3/ui/input'
import { Muted, Section } from '#/components/v3/ui/layout'
import { Secret } from '#/components/v3/ui/secret'
import { authClient } from '#/lib/auth-client'
import { getTwoFactorStatusFn } from './settings-two-factor-data'

/**
 * Two-factor (TOTP) for the signed-in person. Better Auth holds the secret;
 * enrolment is two steps so a typo can never lock someone out: the secret is
 * created unverified and only counts once a first code from the authenticator
 * is accepted. Backup codes are shown once.
 *
 * Two-factor is asked for after an emailed sign-in link. GitHub and company
 * SSO sign-ins rely on that provider's own multi-factor policy.
 */
export const twoFactorQueryKey = ['two-factor-status'] as const

interface Enrolment {
  secret: string
  qr: string
  backupCodes: string[]
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function SettingsTwoFactor() {
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: twoFactorQueryKey,
    queryFn: () => getTwoFactorStatusFn(),
  })
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null)

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: twoFactorQueryKey })

  const begin = useMutation({
    mutationFn: async () => {
      // Better Auth ignores the password for an account with no signing
      // credential, and refuses a wrong or missing one for an account with one.
      const { data, error } = await authClient.twoFactor.enable({
        password,
        method: 'totp',
      })
      if (error) {
        throw new Error(error.message ?? 'Could not start two-factor setup.')
      }
      if (data.method !== 'totp') {
        throw new Error('Could not start two-factor setup.')
      }
      const secret = new URL(data.totpURI).searchParams.get('secret') ?? ''
      setEnrolment({
        secret,
        qr: await QRCode.toDataURL(data.totpURI, { margin: 1, width: 192 }),
        backupCodes: data.backupCodes,
      })
      setPassword('')
    },
  })

  const confirm = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.twoFactor.verifyTotp({
        code: code.replace(/\s/g, ''),
      })
      if (error) throw new Error(error.message ?? 'That code was not accepted.')
    },
    onSuccess: async () => {
      setFreshCodes(enrolment?.backupCodes ?? null)
      setEnrolment(null)
      setCode('')
      await refresh()
    },
  })

  const turnOff = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.twoFactor.disable({ password })
      if (error) throw new Error(error.message ?? 'Could not turn it off.')
    },
    onSuccess: async () => {
      setPassword('')
      setFreshCodes(null)
      await refresh()
    },
  })

  const data = status.data

  return (
    <Section title="Two-factor authentication">
      {status.isLoading ? (
        <Muted>Loading…</Muted>
      ) : status.isError || !data ? (
        <Notice tone="bad">
          {messageOf(status.error, 'Could not load your two-factor status.')}
        </Notice>
      ) : !data.available ? (
        <Muted>
          This environment has no sign-in to protect, so two-factor is not
          offered.
        </Muted>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-body text-fg-muted">
            {data.emailLinkEnabled
              ? 'Asks for a code from your authenticator app after you use an emailed sign-in link. '
              : ''}
            Signing in with GitHub or company SSO follows that provider’s own
            multi-factor policy.
          </p>

          {freshCodes ? (
            <>
              <Notice tone="warn" title="Save your backup codes now.">
                Each works once if you lose your authenticator. They are not
                shown again.
              </Notice>
              <Secret value={freshCodes.join('\n')} copyLabel="Copy codes" />
              <div>
                <Button onClick={() => setFreshCodes(null)}>
                  I’ve saved them
                </Button>
              </div>
            </>
          ) : null}

          {data.enabled ? (
            <>
              <Notice tone="info">Two-factor is on for your account.</Notice>
              {data.needsPassword ? (
                <Field
                  label="Signing password"
                  hint="Confirm it to turn two-factor off."
                >
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
              ) : null}
              {turnOff.isError ? (
                <Notice tone="bad">
                  {messageOf(turnOff.error, 'Could not turn it off.')}
                </Notice>
              ) : null}
              <div>
                <Button
                  disabled={
                    turnOff.isPending || (data.needsPassword && !password)
                  }
                  onClick={() => turnOff.mutate()}
                >
                  Turn off two-factor
                </Button>
              </div>
            </>
          ) : enrolment ? (
            <>
              <p className="m-0 text-body">
                Scan this with an authenticator app, or enter the setup key by
                hand. Then type the 6-digit code it shows.
              </p>
              <img
                src={enrolment.qr}
                width={192}
                height={192}
                alt="QR code for your authenticator app"
                className="rounded-md border border-border"
              />
              <Secret value={enrolment.secret} copyLabel="Copy setup key" />
              <Field label="6-digit code">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </Field>
              {confirm.isError ? (
                <Notice tone="bad">
                  {messageOf(confirm.error, 'That code was not accepted.')}
                </Notice>
              ) : null}
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  disabled={confirm.isPending || code.trim().length < 6}
                  onClick={() => confirm.mutate()}
                >
                  Turn on two-factor
                </Button>
                <Button onClick={() => setEnrolment(null)}>Cancel</Button>
              </div>
            </>
          ) : (
            <>
              {data.needsPassword ? (
                <Field
                  label="Signing password"
                  hint="Confirm it to set up two-factor."
                >
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
              ) : null}
              {begin.isError ? (
                <Notice tone="bad">
                  {messageOf(begin.error, 'Could not start setup.')}
                </Notice>
              ) : null}
              <div>
                <Button
                  variant="primary"
                  disabled={
                    begin.isPending || (data.needsPassword && !password)
                  }
                  onClick={() => begin.mutate()}
                >
                  Set up two-factor
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Section>
  )
}
