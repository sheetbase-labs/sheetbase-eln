import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult } from '@tanstack/react-query'
import QRCode from 'qrcode'

import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Field, Input } from '#/components/ui/input'
import { Muted, Section } from '#/components/ui/layout'
import { Secret } from '#/components/ui/secret'
import { authClient } from '#/lib/auth-client'
import {
  getTwoFactorStatusFn,
  twoFactorQueryKey,
} from './settings-two-factor-data'
import type { TwoFactorStatus } from './settings-two-factor-data'
import { t } from '#/copy'

export { twoFactorQueryKey } from './settings-two-factor-data'

/**
 * Two-factor (TOTP) for the signed-in person. Better Auth holds the secret;
 * enrolment is two steps so a typo can never lock someone out: the secret is
 * created unverified and only counts once a first code from the authenticator
 * is accepted. Backup codes are shown once.
 *
 * Two-factor is asked for after an emailed sign-in link. GitHub and company
 * SSO sign-ins rely on that provider's own multi-factor policy.
 */
interface Enrolment {
  secret: string
  qr: string
  backupCodes: string[]
}

function messageOf(error: Error | null, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function SettingsTwoFactor() {
  const status = useQuery({
    queryKey: twoFactorQueryKey,
    queryFn: () => getTwoFactorStatusFn(),
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
        <TwoFactorControls data={data} />
      )}
    </Section>
  )
}

function TwoFactorControls({ data }: { data: TwoFactorStatus }) {
  const queryClient = useQueryClient()
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null)

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: twoFactorQueryKey })

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- Beginning enrolment only reveals an unverified secret/QR locally; confirm invalidates status after the first accepted code actually enables two-factor.
  const begin = useMutation({
    mutationFn: async () => {
      // Better Auth ignores the password for an account with no signing
      // credential, and refuses a wrong or missing one for an account with one.
      const { data: setup, error } = await authClient.twoFactor.enable({
        password,
        method: 'totp',
      })

      if (error) {
        throw new Error(error.message ?? t('settings.twoFactor.couldStartTwo'))
      }

      if (setup.method !== 'totp') {
        throw new Error('Could not start two-factor setup.')
      }

      const secret = new URL(setup.totpURI).searchParams.get('secret') ?? ''
      setEnrolment({
        secret,
        qr: await QRCode.toDataURL(setup.totpURI, { margin: 1, width: 192 }),
        backupCodes: setup.backupCodes,
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

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-body text-fg-muted">
        {data.emailLinkEnabled
          ? t('settings.twoFactor.asksCodeAuthenticator')
          : ''}
        {t('settings.twoFactor.signingGithubCompany')}
      </p>

      {freshCodes ? (
        <>
          <Notice tone="warn" title={t('settings.twoFactor.saveBackupCodes')}>
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
        <TwoFactorPasswordAction
          enabled
          needsPassword={data.needsPassword}
          password={password}
          onPasswordChange={setPassword}
          action={turnOff}
        />
      ) : enrolment ? (
        <TwoFactorEnrolment
          enrolment={enrolment}
          code={code}
          onCodeChange={setCode}
          confirm={confirm}
          onCancel={() => setEnrolment(null)}
        />
      ) : (
        <TwoFactorPasswordAction
          enabled={false}
          needsPassword={data.needsPassword}
          password={password}
          onPasswordChange={setPassword}
          action={begin}
        />
      )}
    </div>
  )
}

type TwoFactorAction = Pick<
  UseMutationResult<void, Error, void>,
  'error' | 'isError' | 'isPending' | 'mutate'
>

function TwoFactorEnrolment({
  enrolment,
  code,
  onCodeChange,
  confirm,
  onCancel,
}: {
  enrolment: Enrolment
  code: string
  onCodeChange: (value: string) => void
  confirm: TwoFactorAction
  onCancel: () => void
}) {
  return (
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
          onChange={(event) => onCodeChange(event.target.value)}
        />
      </Field>
      {confirm.isError ? (
        <Notice tone="bad">
          {messageOf(confirm.error, t('settings.twoFactor.codeNotAccepted'))}
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
        <Button onClick={onCancel}>{t('common.actions.cancel')}</Button>
      </div>
    </>
  )
}

function TwoFactorPasswordAction({
  enabled,
  needsPassword,
  password,
  onPasswordChange,
  action,
}: {
  enabled: boolean
  needsPassword: boolean
  password: string
  onPasswordChange: (value: string) => void
  action: TwoFactorAction
}) {
  return (
    <>
      {enabled ? (
        <Notice tone="info">{t('settings.twoFactor.twoFactorAccount')}</Notice>
      ) : null}
      {needsPassword ? (
        <Field
          label={t('settings.twoFactor.signingPassword')}
          hint={
            enabled
              ? t('settings.twoFactor.confirmTurnTwoHint')
              : t('settings.twoFactor.confirmSetUpHint')
          }
        >
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
        </Field>
      ) : null}
      {action.isError ? (
        <Notice tone="bad">
          {messageOf(
            action.error,
            enabled
              ? t('settings.twoFactor.couldTurnOff')
              : t('settings.twoFactor.couldStartSetup'),
          )}
        </Notice>
      ) : null}
      <div>
        <Button
          variant={enabled ? undefined : 'primary'}
          disabled={action.isPending || (needsPassword && !password)}
          onClick={() => action.mutate()}
        >
          {enabled
            ? t('settings.twoFactor.turnOffTwo')
            : t('settings.twoFactor.setUpTwo')}
        </Button>
      </div>
    </>
  )
}
