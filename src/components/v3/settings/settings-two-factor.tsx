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
import { t } from '#/copy'

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
        throw new Error(error.message ?? t('settings.twoFactor.couldStartTwo'))
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
      if (error)
        throw new Error(error.message ?? t('settings.twoFactor.codeAccepted'))
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
      if (error)
        throw new Error(error.message ?? t('settings.twoFactor.couldTurnOff'))
    },
    onSuccess: async () => {
      setPassword('')
      setFreshCodes(null)
      await refresh()
    },
  })

  const data = status.data

  return (
    <Section title={t('settings.twoFactor.twoFactorAuthentication')}>
      {status.isLoading ? (
        <Muted>{t('common.states.loading')}</Muted>
      ) : status.isError || !data ? (
        <Notice tone="bad">
          {messageOf(status.error, t('settings.twoFactor.couldLoadStatus'))}
        </Notice>
      ) : !data.available ? (
        <Muted>{t('settings.twoFactor.environmentSignProtect')}</Muted>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-body text-fg-muted">
            {data.emailLinkEnabled
              ? t('settings.twoFactor.asksCodeAuthenticator')
              : ''}
            {t('settings.twoFactor.signingGithubCompany')}
          </p>

          {freshCodes ? (
            <>
              <Notice
                tone="warn"
                title={t('settings.twoFactor.saveBackupCodes')}
              >
                {t('settings.twoFactor.eachWorksOnce')}
              </Notice>
              <Secret
                value={freshCodes.join('\n')}
                copyLabel={t('settings.twoFactor.copyCodes')}
              />
              <div>
                <Button onClick={() => setFreshCodes(null)}>
                  {t('settings.twoFactor.iVeSaved')}
                </Button>
              </div>
            </>
          ) : null}

          {data.enabled ? (
            <>
              <Notice tone="info">
                {t('settings.twoFactor.twoFactorAccount')}
              </Notice>
              {data.needsPassword ? (
                <Field
                  label={t('settings.twoFactor.signingPassword')}
                  hint={t('settings.twoFactor.confirmTurnTwoHint')}
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
                  {messageOf(
                    turnOff.error,
                    t('settings.twoFactor.couldTurnOff'),
                  )}
                </Notice>
              ) : null}
              <div>
                <Button
                  disabled={
                    turnOff.isPending || (data.needsPassword && !password)
                  }
                  onClick={() => turnOff.mutate()}
                >
                  {t('settings.twoFactor.turnOffTwo')}
                </Button>
              </div>
            </>
          ) : enrolment ? (
            <>
              <p className="m-0 text-body">
                {t('settings.twoFactor.scanAuthenticatorApp')}
              </p>
              <img
                src={enrolment.qr}
                width={192}
                height={192}
                alt={t('settings.twoFactor.qrCodeAuthenticator')}
                className="rounded-md border border-border"
              />
              <Secret
                value={enrolment.secret}
                copyLabel={t('settings.twoFactor.copySetupKey')}
              />
              <Field label={t('settings.twoFactor.n6DigitCode')}>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </Field>
              {confirm.isError ? (
                <Notice tone="bad">
                  {messageOf(
                    confirm.error,
                    t('settings.twoFactor.codeNotAccepted'),
                  )}
                </Notice>
              ) : null}
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  disabled={confirm.isPending || code.trim().length < 6}
                  onClick={() => confirm.mutate()}
                >
                  {t('settings.twoFactor.turnTwoFactor')}
                </Button>
                <Button onClick={() => setEnrolment(null)}>
                  {t('common.actions.cancel')}
                </Button>
              </div>
            </>
          ) : (
            <>
              {data.needsPassword ? (
                <Field
                  label={t('settings.twoFactor.signingPassword')}
                  hint={t('settings.twoFactor.confirmSetUpHint')}
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
                  {messageOf(
                    begin.error,
                    t('settings.twoFactor.couldStartSetup'),
                  )}
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
                  {t('settings.twoFactor.setUpTwo')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Section>
  )
}
