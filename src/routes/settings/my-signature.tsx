import { useState } from 'react'
import { formatDate } from '#/lib/format-date'
import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '#/components/v3/ui/collapsible'
import { Status } from '#/components/v3/ui/status'
import { Checkbox } from '#/components/v3/ui/checkbox'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/v3/ui/confirm-dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Muted, Section } from '#/components/v3/ui/layout'
import { TableBox } from '#/components/v3/ui/table'
import { RegistryGrid } from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { toast } from '#/components/v3/ui/sonner'
import { safeReturnTo } from '#/lib/create-context-search'
import { returnLabel } from '#/lib/return-to'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import { canManageSettings } from '#/lib/settings-access'
import {
  SIGNATURE_STATEMENT,
  SIGNATURE_STATEMENT_VERSION,
  fetchSignatureStatement,
  signatureStatementQueryKeys,
  certifySignature,
  fetchWorkspaceCertifications,
  isCurrentStatement,
  practiceSignature,
  requestIdentityVerification,
  selfVerifySignatureIdentity,
  signatureCertificationDataClient,
  signatureCertificationQueryKeys,
  withdrawSignatureCertification,
} from '#/lib/signature-certification'
import { requestSignatureCredential } from '#/lib/signatures'
import {
  getWorkspaceAdmins,
  workspaceAdminsKey,
  formatAdminNames,
} from '#/lib/workspace-admins'
import { useRegulatedLab } from '#/lib/regulated-lab'
import { t } from '#/copy'

/** The person's own electronic signature (the Account section of Settings):
 * you certify it for the workspace. The workspace policy lives under
 * Electronic signatures. Certification is a per-user attestation (SIGN-003),
 * never a record write. */
/** The three signature meanings, as the reference describes them. */
const MEANING_ROWS = [
  {
    meaning: 'Authored',
    who: t('settings.mySignature.recordAuthorBefore'),
    usedFor: t('settings.mySignature.ownRecords'),
  },
  {
    meaning: 'Reviewed',
    who: t('settings.mySignature.reviewerAfterReading'),
    usedFor: t('settings.mySignature.reviewStepBefore'),
  },
  {
    meaning: 'Approved',
    who: t('settings.mySignature.approverFinalDecision'),
    usedFor: t('settings.mySignature.releasingRecordEvidence'),
  },
] as const

const signatureMeaningColumns: RegistryColumn<(typeof MEANING_ROWS)[number]>[] =
  [
    {
      id: 'meaning',
      header: 'Meaning',
      meta: { cellClassName: 'font-medium' },
      cell: ({ row }) => row.original.meaning,
    },
    {
      id: 'who',
      header: t('settings.mySignature.whoSign'),
      meta: { cellClassName: 'text-fg-muted' },
      cell: ({ row }) => row.original.who,
    },
    {
      id: 'usedFor',
      header: t('settings.mySignature.used'),
      meta: { cellClassName: 'text-fg-muted' },
      cell: ({ row }) => row.original.usedFor,
    },
  ]

/**
 * Regulated signing always re-establishes the account session, and the step-up
 * boundary deliberately refuses the auth-free development identity. This tells
 * the surface whether a real sign-in exists, so it can explain an unavailable
 * control instead of offering one whose every attempt ends in a 401.
 */
const getSigningAvailability = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { isDevAuthFreeEnabled } = await import('#/lib/auth')
    return { signInAvailable: !isDevAuthFreeEnabled() }
  },
)

export const Route = createFileRoute('/settings/my-signature')({
  // A page that sent the person here to certify hands over where to go back to.
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } => {
    const returnTo = safeReturnTo(search.returnTo)
    return returnTo ? { returnTo } : {}
  },
  loader: () => getSigningAvailability(),
  component: MySignature,
})

/**
 * J-SET-02: nobody can verify their own identity, so a sole owner needs a
 * second administrator before they can certify. Say who that could be now, or
 * how to get one.
 */
export function VerificationPath({
  requested,
  canInvite,
  admins,
  loaded,
}: {
  requested: boolean
  canInvite: boolean
  admins: readonly { name: string }[]
  loaded: boolean
}) {
  if (requested) {
    const names = formatAdminNames(admins)
    return (
      <Muted>
        <span>
          {t('settings.mySignature.awaitingIndependentAdministrator')}
        </span>
        {names ? (
          <span>{t('settings.mySignature.askOpenElectronic', { names })}</span>
        ) : null}
      </Muted>
    )
  }
  if (loaded && admins.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <Muted>
          {t('settings.mySignature.nobodyVerifyYet')}
          {canInvite
            ? t('settings.mySignature.inviteOneOnce')
            : t('settings.mySignature.askOwnerInvite')}
        </Muted>
        {canInvite ? (
          <div>
            <Button
              size="sm"
              nativeButton={false}
              render={
                <Link to="/settings/members" search={{ invite: 'admin' }} />
              }
            >
              {t('settings.mySignature.inviteAnotherAdministrator')}
            </Button>
          </div>
        ) : null}
      </div>
    )
  }
  const names = formatAdminNames(admins)
  return (
    <Muted>
      {t('settings.mySignature.askDifferentAdmin', {
        names: names ? ` (${names})` : '',
      })}
    </Muted>
  )
}

function MySignature() {
  const { context } = Route.useRouteContext()
  const { returnTo } = Route.useSearch()
  const { signInAvailable } = Route.useLoaderData()
  const workspaceId = context.workspace?.id ?? ''
  const canManage = canManageSettings(context.workspace, 'members')
  const queryClient = useQueryClient()
  const [agreed, setAgreed] = useState(false)
  const [password, setPassword] = useState('')
  // Withdrawing revokes signing eligibility for every record, so it asks first.
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)

  const certifications = useQuery({
    queryKey: signatureCertificationQueryKeys.workspace(workspaceId),
    queryFn: () =>
      fetchWorkspaceCertifications(
        signatureCertificationDataClient,
        workspaceId,
      ),
    enabled: Boolean(workspaceId),
  })

  // Who could verify me: the other active owners and administrators.
  const otherAdmins = useQuery({
    queryKey: workspaceAdminsKey(workspaceId),
    queryFn: async () =>
      (await getWorkspaceAdmins()).filter(
        (a) => a.email !== context.user.email,
      ),
    enabled: Boolean(workspaceId),
  })
  const { regulated } = useRegulatedLab(workspaceId)
  const mine = (certifications.data ?? []).find(
    (c) => c.userId === context.user.id,
  )
  const current = isCurrentStatement(mine)
  const statementQuery = useQuery({
    queryKey: signatureStatementQueryKeys.workspace(workspaceId),
    queryFn: () =>
      fetchSignatureStatement(signatureCertificationDataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  const statement = statementQuery.data ?? {
    text: SIGNATURE_STATEMENT,
    version: SIGNATURE_STATEMENT_VERSION,
    custom: false,
  }

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: signatureCertificationQueryKeys.workspace(workspaceId),
    })
  }

  const certify = useMutation({
    mutationFn: () => {
      const enteredPassword = password
      setPassword('')
      return certifySignature(
        signatureCertificationDataClient,
        workspaceId,
        enteredPassword,
        statement.version,
      )
    },
    onSuccess: () => {
      setAgreed(false)
      invalidate()
      toast(t('settings.mySignature.signatureCertifiedToast'), {
        description: t(
          'settings.mySignature.recordedStatementVersionDescription',
        ),
      })
    },
    onError: (error: unknown) =>
      toast(t('settings.mySignature.couldCertifyToast'), {
        description:
          error instanceof Error
            ? error.message
            : t('settings.mySignature.databaseRefused'),
      }),
  })

  const verify = useMutation({
    mutationFn: () =>
      requestIdentityVerification(signatureCertificationDataClient),
    onSuccess: invalidate,
  })
  const confirmSelf = useMutation({
    mutationFn: async () => {
      await requestIdentityVerification(signatureCertificationDataClient)
      await selfVerifySignatureIdentity(
        signatureCertificationDataClient,
        context.user.email,
      )
    },
    onSuccess: () => {
      invalidate()
      toast(t('settings.mySignature.identityConfirmedToast'))
    },
  })
  const practice = useMutation({
    mutationFn: () => {
      const enteredPassword = password
      setPassword('')
      return practiceSignature(
        signatureCertificationDataClient,
        workspaceId,
        enteredPassword,
      )
    },
    onSuccess: () =>
      toast(t('settings.mySignature.practiceSignatureCompletedToast'), {
        description: t(
          'settings.mySignature.passwordCertificationVerifiedDescription',
        ),
      }),
  })

  const withdraw = useMutation({
    mutationFn: () =>
      withdrawSignatureCertification(
        signatureCertificationDataClient,
        workspaceId,
      ),
    onSuccess: () => {
      invalidate()
      toast(t('settings.mySignature.certificationWithdrawnToast'), {
        description: t('settings.mySignature.cannotSignUntilDescription'),
      })
    },
    onError: (error: unknown) =>
      toast(t('settings.mySignature.couldWithdrawToast'), {
        description:
          error instanceof Error
            ? error.message
            : t('settings.mySignature.databaseRefused'),
      }),
  })

  return (
    <>
      <SettingsHeader title={t('settings.mySignature.mySignature')}>
        {context.workspace?.name ?? 'Workspace'}
        {t('settings.mySignature.signatureDeliberateAct')}
      </SettingsHeader>
      <SettingsBody>
        {returnTo ? (
          <Notice
            title={
              current
                ? t('settings.mySignature.signNow')
                : t('settings.mySignature.cameCertify')
            }
          >
            <p className="m-0">
              {current
                ? t('settings.mySignature.signatureCertifiedTask')
                : t('settings.mySignature.finishCertifyingBelow')}
            </p>
            <p className="m-0 mt-1.5">
              <Button
                size="sm"
                nativeButton={false}
                render={<Link to={returnTo} />}
              >
                {returnLabel(returnTo)}
              </Button>
            </p>
          </Notice>
        ) : null}
        {signInAvailable ? null : (
          <Notice
            tone="warn"
            title={t('settings.mySignature.signingNeedsSigned')}
          >
            {t('settings.mySignature.environmentRunsWithout')}
          </Notice>
        )}
        <Section title={t('settings.mySignature.confirmIdentity')}>
          {mine?.identityVerifiedAt ? (
            <p className="m-0 text-body">
              {t('settings.mySignature.verifiedBy', {
                name:
                  (certifications.data ?? []).find(
                    (c) => c.userId === mine.identityVerifiedBy,
                  )?.name ?? t('settings.mySignature.aDifferentAdmin'),
                when: formatDate(mine.identityVerifiedAt),
                email: mine.verifiedEmail ?? '',
              })}
            </p>
          ) : !regulated ? (
            <Muted>{t('settings.mySignature.selfConfirmNote')}</Muted>
          ) : (
            <VerificationPath
              requested={Boolean(mine?.verificationRequested)}
              canInvite={canManage}
              admins={otherAdmins.data ?? []}
              loaded={otherAdmins.isSuccess}
            />
          )}
          <Button
            className="self-start"
            size="sm"
            variant={
              !regulated && !mine?.identityVerifiedAt ? 'primary' : undefined
            }
            disabled={
              !signInAvailable ||
              verify.isPending ||
              confirmSelf.isPending ||
              certifications.isPending
            }
            onClick={() => (regulated ? verify.mutate() : confirmSelf.mutate())}
          >
            {!regulated
              ? t('settings.mySignature.confirmItsMe')
              : mine?.identityVerifiedAt
                ? t('settings.mySignature.requestNewVerification')
                : t('settings.mySignature.requestIdentityVerification')}
          </Button>
          <Muted>
            {t('settings.mySignature.requestingVerificationRevokes')}
          </Muted>
          {verify.error ? (
            <Notice tone="bad">{verify.error.message}</Notice>
          ) : null}
          {confirmSelf.error ? (
            <Notice tone="bad">{confirmSelf.error.message}</Notice>
          ) : null}
        </Section>
        <CredentialEnrollment
          workspaceId={workspaceId}
          verified={Boolean(mine?.identityVerifiedAt)}
          available={signInAvailable}
          onChanged={invalidate}
        />
        <Section
          title={t('settings.mySignature.signature')}
          count={
            current ? (
              <Status tone="ok">{t('settings.mySignature.certified')}</Status>
            ) : (
              <Status tone="warn">
                {t('settings.mySignature.certified2')}
              </Status>
            )
          }
        >
          {current ? (
            <div className="flex flex-col gap-2 text-body">
              <p className="m-0">
                {t('settings.mySignature.certifiedAgainst', {
                  when: formatDate(mine?.certifiedAt),
                  version: mine?.statementVersion ?? '',
                })}
              </p>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  disabled={!signInAvailable || withdraw.isPending}
                  onClick={() => setConfirmWithdraw(true)}
                >
                  {t('settings.mySignature.withdrawCertification')}
                </Button>
              </div>
              {!signInAvailable ? (
                <span className="text-label text-fg-muted">
                  {t('settings.mySignature.certificationCannotEstablished')}
                </span>
              ) : null}
              <Field
                label={t('settings.mySignature.signingPassword')}
                hint={t('settings.mySignature.enterAgainPracticeHint')}
              >
                <Input
                  type="password"
                  autoComplete="current-password"
                  disabled={!signInAvailable}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Button
                className="self-start"
                size="sm"
                disabled={!signInAvailable || !password || practice.isPending}
                onClick={() => practice.mutate()}
              >
                {t('settings.mySignature.tryPracticeSignature')}
              </Button>
              {practice.error ? (
                <Notice tone="bad">{practice.error.message}</Notice>
              ) : null}
            </div>
          ) : (
            <>
              {mine?.certifiedAt ? (
                <p className="m-0 mb-2 text-label text-warning-text">
                  {t('settings.mySignature.certificationLongerEligible')}
                </p>
              ) : null}
              <p className="m-0 rounded-md bg-surface-muted px-3 py-2.5 text-body leading-[19px]">
                {statement.text}
              </p>
              <label className="flex cursor-pointer items-center gap-2 text-body">
                <Checkbox
                  checked={agreed}
                  onCheckedChange={(v) => setAgreed(Boolean(v))}
                />
                {t('settings.mySignature.iReadAgree')}
              </label>
              <Field
                label={t('settings.mySignature.enterSigningPassword')}
                hint={t('settings.mySignature.useLocalSigningHint')}
              >
                <Input
                  type="password"
                  autoComplete="current-password"
                  disabled={!signInAvailable}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  disabled={
                    !signInAvailable ||
                    !agreed ||
                    !password ||
                    !mine?.identityVerifiedAt ||
                    certify.isPending
                  }
                  onClick={() => certify.mutate()}
                >
                  {t('settings.mySignature.certifySignature')}
                </Button>
                {!mine?.identityVerifiedAt ? (
                  <span className="text-label text-fg-muted">
                    {t('settings.mySignature.independentIdentityVerification')}
                  </span>
                ) : !agreed ? (
                  <span className="text-label text-fg-muted">
                    {t('settings.mySignature.agreeStatementContinue')}
                  </span>
                ) : null}
              </div>
              {certify.error ? (
                <Notice tone="bad">
                  {certify.error instanceof Error
                    ? certify.error.message
                    : t('settings.mySignature.certificationRefused')}
                </Notice>
              ) : null}
            </>
          )}
        </Section>

        <Section
          title={t('settings.mySignature.signatureMeanings')}
          count={MEANING_ROWS.length}
        >
          <TableBox>
            <RegistryGrid
              label={t('settings.mySignature.signatureMeanings')}
              rows={[...MEANING_ROWS]}
              columns={signatureMeaningColumns}
              getRowId={(meaning) => meaning.meaning}
              selectable={false}
            />
          </TableBox>
        </Section>
      </SettingsBody>
      <ConfirmDialog open={confirmWithdraw} onOpenChange={setConfirmWithdraw}>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('settings.mySignature.withdrawCertification2')}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('settings.mySignature.cannotApplyElectronic')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={withdraw.isPending}>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              variant="danger-fill"
              disabled={withdraw.isPending}
              onClick={() => withdraw.mutate()}
            >
              {t('settings.mySignature.withdrawCertification')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </>
  )
}

function CredentialEnrollment({
  workspaceId,
  verified,
  available,
  onChanged,
}: {
  workspaceId: string
  verified: boolean
  available: boolean
  onChanged: () => void
}) {
  const [recovering, setRecovering] = useState(false)
  const [secret, setSecret] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: () =>
      requestSignatureCredential({
        workspaceId,
        purpose: recovering ? 'recover-request' : 'enroll-request',
      }),
    onSuccess: () => setMessage(t('settings.mySignature.oneUseSecret')),
  })
  const enroll = useMutation({
    mutationFn: () => {
      const input = {
        workspaceId,
        purpose: recovering ? 'recover' : 'enroll',
        secret,
        password,
      } satisfies Parameters<typeof requestSignatureCredential>[0]
      setPassword('')
      setSecret('')
      return requestSignatureCredential(input)
    },
    onSuccess: () => {
      onChanged()
      setMessage(
        recovering
          ? t('settings.mySignature.recoveryCompletedOld')
          : t('settings.mySignature.signingPasswordEnrolled'),
      )
    },
  })
  return (
    <Section title={t('settings.mySignature.signingPassword2')}>
      <Collapsible>
        <CollapsibleTrigger className="text-body">
          {t('settings.mySignature.setUpRecover')}
        </CollapsibleTrigger>
        <CollapsiblePanel className="mt-2 flex flex-col gap-2">
          <Muted>
            {t('settings.mySignature.freshIndependentVerification')}
          </Muted>
          <label className="flex items-center gap-2 text-body">
            <Checkbox
              checked={recovering}
              onCheckedChange={(value) => {
                setRecovering(Boolean(value))
                setMessage(null)
                setPassword('')
                setSecret('')
              }}
            />
            {t('settings.mySignature.recoverExistingCredential')}
          </label>
          <Button
            className="self-start"
            disabled={
              !available || !verified || send.isPending || enroll.isPending
            }
            onClick={() => send.mutate()}
          >
            {t('settings.mySignature.sendOneUse')}
          </Button>
          <Field label={t('settings.mySignature.oneUseEmail')}>
            <Input
              autoComplete="off"
              disabled={!available}
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
          </Field>
          <Field
            label={t('settings.mySignature.newSigningPassword')}
            hint={t('settings.mySignature.n8128CharactersHint')}
          >
            <Input
              type="password"
              autoComplete="new-password"
              disabled={!available}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Button
            className="self-start"
            disabled={
              !available ||
              !verified ||
              !secret ||
              !password ||
              enroll.isPending
            }
            onClick={() => enroll.mutate()}
          >
            {recovering
              ? t('settings.mySignature.recoverSigningPassword')
              : t('settings.mySignature.enrollSigningPassword')}
          </Button>
          {message ? <Notice>{message}</Notice> : null}
          {send.error || enroll.error ? (
            <Notice tone="bad">{(send.error ?? enroll.error)?.message}</Notice>
          ) : null}
        </CollapsiblePanel>
      </Collapsible>
    </Section>
  )
}
