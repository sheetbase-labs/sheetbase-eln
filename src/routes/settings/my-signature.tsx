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
  certifySignature,
  fetchWorkspaceCertifications,
  isCurrentStatement,
  practiceSignature,
  requestIdentityVerification,
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

/** The person's own electronic signature (the Account section of Settings):
 * you certify it for the workspace. The workspace policy lives under
 * Electronic signatures. Certification is a per-user attestation (SIGN-003),
 * never a record write. */
/** The three signature meanings, as the reference describes them. */
const MEANING_ROWS = [
  {
    meaning: 'Authored',
    who: 'The record author, before it is submitted',
    usedFor: 'Your own records',
  },
  {
    meaning: 'Reviewed',
    who: 'A reviewer, after reading the record',
    usedFor: 'The review step before approval',
  },
  {
    meaning: 'Approved',
    who: 'An approver, as the final decision',
    usedFor: 'Releasing the record as evidence',
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
      header: 'Who can sign',
      meta: { cellClassName: 'text-fg-muted' },
      cell: ({ row }) => row.original.who,
    },
    {
      id: 'usedFor',
      header: 'Used for',
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
        <span>Awaiting independent administrator verification.</span>
        {names ? (
          <span>
            {' '}
            Ask {names} to open Electronic signatures in Settings, find your
            name and confirm your identity.
          </span>
        ) : null}
      </Muted>
    )
  }
  if (loaded && admins.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <Muted>
          Nobody can verify you yet. A workspace owner cannot verify their own
          identity, so this workspace needs a second owner or administrator
          first.{' '}
          {canInvite
            ? 'Invite one, and once they have joined, request verification below.'
            : 'Ask an owner to invite one.'}
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
              Invite another administrator
            </Button>
          </div>
        ) : null}
      </div>
    )
  }
  const names = formatAdminNames(admins)
  return (
    <Muted>
      Ask a different active owner or administrator
      {names ? ` (${names})` : ''} to independently confirm your identity and
      email. A workspace owner cannot verify their own identity.
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
  const mine = (certifications.data ?? []).find(
    (c) => c.userId === context.user.id,
  )
  const current = isCurrentStatement(mine)

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
        SIGNATURE_STATEMENT_VERSION,
      )
    },
    onSuccess: () => {
      setAgreed(false)
      invalidate()
      toast('Signature certified', {
        description: 'Recorded with the statement version you agreed to.',
      })
    },
    onError: (error: unknown) =>
      toast('Could not certify', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  const verify = useMutation({
    mutationFn: () =>
      requestIdentityVerification(signatureCertificationDataClient),
    onSuccess: invalidate,
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
      toast('Practice signature completed', {
        description:
          'Password and certification verified. No real record signature was stored.',
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
      toast('Certification withdrawn', {
        description: 'You cannot sign until you certify again.',
      })
    },
    onError: (error: unknown) =>
      toast('Could not withdraw', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  return (
    <>
      <SettingsHeader title="My signature">
        {context.workspace?.name ?? 'Workspace'} · a signature is a deliberate
        act; every one records who, when and what version
      </SettingsHeader>
      <SettingsBody>
        {returnTo ? (
          <Notice
            title={current ? 'You can sign now' : 'You came here to certify'}
          >
            <p className="m-0">
              {current
                ? 'Your signature is certified, so the task you left can go ahead.'
                : 'Finish certifying below, then go back to the task you left.'}
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
          <Notice tone="warn" title="Signing needs a signed-in account">
            This environment runs without sign-in, so identity verification,
            signature certification, practice signatures and signing-password
            setup are unavailable. They work once sign-in is configured; nothing
            here records a signature.
          </Notice>
        )}
        <Section title="Confirm your identity">
          {mine?.identityVerifiedAt ? (
            <p className="m-0 text-body">
              Verified by{' '}
              {(certifications.data ?? []).find(
                (c) => c.userId === mine.identityVerifiedBy,
              )?.name ?? 'a different administrator'}{' '}
              on {formatDate(mine.identityVerifiedAt)} · {mine.verifiedEmail}.
            </p>
          ) : (
            <VerificationPath
              requested={Boolean(mine?.verificationRequested)}
              canInvite={canManage}
              admins={otherAdmins.data ?? []}
              loaded={otherAdmins.isSuccess}
            />
          )}
          <Button
            size="sm"
            disabled={
              !signInAvailable || verify.isPending || certifications.isPending
            }
            onClick={() => verify.mutate()}
          >
            {mine?.identityVerifiedAt
              ? 'Request new verification for recovery'
              : 'Request identity verification'}
          </Button>
          <Muted>
            Requesting verification revokes signing eligibility and outstanding
            signing grants. The administrator never chooses or sees your
            password.
          </Muted>
          {verify.error ? (
            <Notice tone="bad">{verify.error.message}</Notice>
          ) : null}
        </Section>
        <CredentialEnrollment
          workspaceId={workspaceId}
          verified={Boolean(mine?.identityVerifiedAt)}
          available={signInAvailable}
          onChanged={invalidate}
        />
        <Section
          title="Your signature"
          count={
            current ? (
              <Status tone="ok">Certified</Status>
            ) : (
              <Status tone="warn">Not certified</Status>
            )
          }
        >
          {current ? (
            <div className="flex flex-col gap-2 text-body">
              <p className="m-0">
                Certified {formatDate(mine?.certifiedAt)} against statement
                version {mine?.statementVersion}.
              </p>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  disabled={!signInAvailable || withdraw.isPending}
                  onClick={() => setConfirmWithdraw(true)}
                >
                  Withdraw certification
                </Button>
              </div>
              {!signInAvailable ? (
                <span className="text-label text-fg-muted">
                  Certification cannot be established again without sign-in, so
                  withdrawing it is unavailable here.
                </span>
              ) : null}
              <Field
                label="Signing password"
                hint="Enter it again for a practice signature. No real record signature is stored."
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
                size="sm"
                disabled={!signInAvailable || !password || practice.isPending}
                onClick={() => practice.mutate()}
              >
                Try a practice signature
              </Button>
              {practice.error ? (
                <Notice tone="bad">{practice.error.message}</Notice>
              ) : null}
            </div>
          ) : (
            <>
              {mine?.certifiedAt ? (
                <p className="m-0 mb-2 text-label text-warning-text">
                  This certification is no longer eligible for signing. Complete
                  independent verification and certify again with your password.
                </p>
              ) : null}
              <p className="m-0 rounded-md bg-surface-muted px-3 py-2.5 text-body leading-[19px]">
                {SIGNATURE_STATEMENT}
              </p>
              <label className="flex cursor-pointer items-center gap-2 text-body">
                <Checkbox
                  checked={agreed}
                  onCheckedChange={(v) => setAgreed(Boolean(v))}
                />
                I have read and agree to this statement
              </label>
              <Field
                label="Enter your signing password to certify"
                hint="Use your local signing password, including if you sign in through company SSO."
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
                  Certify signature
                </Button>
                {!mine?.identityVerifiedAt ? (
                  <span className="text-label text-fg-muted">
                    Independent identity verification is required first
                  </span>
                ) : !agreed ? (
                  <span className="text-label text-fg-muted">
                    Agree to the statement to continue
                  </span>
                ) : null}
              </div>
              {certify.error ? (
                <Notice tone="bad">
                  {certify.error instanceof Error
                    ? certify.error.message
                    : 'Certification was refused.'}
                </Notice>
              ) : null}
            </>
          )}
        </Section>

        <Section title="Signature meanings" count={MEANING_ROWS.length}>
          <TableBox>
            <RegistryGrid
              label="Signature meanings"
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
              Withdraw your certification?
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              You cannot apply an electronic signature until you complete
              independent verification and certify again. Signatures you have
              already applied keep their certification at the time they were
              made.
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={withdraw.isPending}>
              Cancel
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              variant="danger-fill"
              disabled={withdraw.isPending}
              onClick={() => withdraw.mutate()}
            >
              Withdraw certification
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
    onSuccess: () =>
      setMessage(
        'A one-use secret was delivered to your independently verified email. It expires in five minutes; reissuing invalidates the previous secret.',
      ),
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
          ? 'Recovery completed. Old sessions and signing grants were revoked. Sign in again, then certify your signature.'
          : 'Signing password enrolled. Agree to the statement and enter it again to certify.',
      )
    },
  })
  return (
    <Section title="Your signing password">
      <Collapsible>
        <CollapsibleTrigger className="text-body">
          Set up or recover a local signing password
        </CollapsibleTrigger>
        <CollapsiblePanel className="mt-2 flex flex-col gap-2">
          <Muted>
            Fresh independent verification must authorize this current session.
            Email is sent immediately over certificate-validated TLS; there is
            no browser or administrator secret fallback. Recovery revokes old
            signing grants and sessions.
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
            Recover an existing credential instead of first enrollment
          </label>
          <Button
            disabled={
              !available || !verified || send.isPending || enroll.isPending
            }
            onClick={() => send.mutate()}
          >
            Send one-use secret to verified email
          </Button>
          <Field label="One-use email secret">
            <Input
              autoComplete="off"
              disabled={!available}
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
          </Field>
          <Field
            label="New signing password"
            hint="8–128 characters. Your administrator never sees this password."
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
              ? 'Recover signing password'
              : 'Enroll signing password'}
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
