import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '#/components/v3/ui/collapsible'
import { Status } from '#/components/v3/ui/status'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Muted, Section } from '#/components/v3/ui/layout'
import { toast } from '#/components/v3/ui/sonner'
import {
  CheckRow,
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import { isSigningRole } from '#/components/v3/settings/settings-nav'
import { createDataClient } from '#/lib/data-client'
import {
  adminQueryKeys,
  fetchWorkspaceMembers,
  fetchWorkspaceSettings,
  updateWorkspaceSettings,
} from '#/lib/workspace-admin'
import {
  fetchWorkspaceCertifications,
  isCurrentStatement,
  verifySignatureIdentity,
  readSignaturePolicy,
  fetchSignatureStatement,
  updateSignatureStatement,
  signatureStatementQueryKeys,
  signatureCertificationDataClient,
  signatureCertificationQueryKeys,
} from '#/lib/signature-certification'
import type { SignaturePolicy } from '#/lib/signature-certification'
import { canManageSettings } from '#/lib/settings-access'

/** The workspace's electronic-signature policy: which meanings are in use and
 * who still needs to certify. A person certifies their own signature under My
 * signature (`my-signature.tsx`). */
export const Route = createFileRoute('/settings/signatures')({
  component: Signatures,
})

const dataClient = createDataClient()

function Signatures() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const canManage = canManageSettings(context.workspace, 'signatures')
  const canVerify = canManageSettings(context.workspace, 'members')
  const queryClient = useQueryClient()

  const certifications = useQuery({
    queryKey: signatureCertificationQueryKeys.workspace(workspaceId),
    queryFn: () =>
      fetchWorkspaceCertifications(
        signatureCertificationDataClient,
        workspaceId,
      ),
    enabled: Boolean(workspaceId),
  })
  const settings = useQuery({
    queryKey: adminQueryKeys.settings(workspaceId),
    queryFn: () => fetchWorkspaceSettings(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  const members = useQuery({
    queryKey: adminQueryKeys.members(workspaceId),
    queryFn: () => fetchWorkspaceMembers(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })

  // Clients and read-only viewers have nothing to sign, so they are never
  // "missing" a certification.
  const signers = new Set(
    (members.data ?? [])
      .filter((m) => !m.suspendedAt && isSigningRole(m.role))
      .map((m) => m.userId),
  )
  const uncertified = (certifications.data ?? []).filter(
    (c) => !isCurrentStatement(c) && signers.has(c.userId),
  )
  const policy = readSignaturePolicy(settings.data?.signaturePolicy)

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: signatureCertificationQueryKeys.workspace(workspaceId),
    })
    void queryClient.invalidateQueries({
      queryKey: adminQueryKeys.settings(workspaceId),
    })
  }

  return (
    <>
      <SettingsHeader title="Electronic signatures">
        {context.workspace?.name ?? 'Workspace'} · which signature meanings are
        in use, and who still needs to certify. Your own signature is under{' '}
        <Link to="/settings/my-signature">My signature</Link>.
      </SettingsHeader>
      <SettingsBody>
        <PolicySection
          key={settings.isSuccess ? 'loaded' : 'loading'}
          policy={policy}
          canManage={canManage}
          workspaceId={workspaceId}
          onSaved={invalidate}
        />

        <StatementSection
          workspaceId={workspaceId}
          canManage={canManage}
          onSaved={invalidate}
        />

        <Section
          title={t('settings.signatures.peopleWithoutCertified')}
          count={uncertified.length}
        >
          {uncertified.length ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-body">
              {uncertified.map((c) => (
                <li
                  key={c.userId}
                  className="flex flex-wrap items-center gap-2"
                >
                  <Status tone="warn">{c.name}</Status>
                  <span className="text-fg-muted">
                    {t('settings.signatures.cannotApplyElectronic')}
                  </span>
                  {canVerify &&
                  c.userId !== context.user.id &&
                  c.verificationRequested ? (
                    <IdentityVerification
                      userId={c.userId}
                      name={c.name}
                      onVerified={invalidate}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : members.isPending || certifications.isPending ? (
            <Muted>Loading…</Muted>
          ) : (
            <Muted>Everyone who can sign has certified their signature.</Muted>
          )}
        </Section>
      </SettingsBody>
    </>
  )
}

function PolicySection({
  policy,
  canManage,
  workspaceId,
  onSaved,
}: {
  policy: SignaturePolicy
  canManage: boolean
  workspaceId: string
  onSaved: () => void
}) {
  const [meanings, setMeanings] = useState<Record<string, boolean>>(
    policy.meanings,
  )

  const save = useMutation({
    mutationFn: () =>
      updateWorkspaceSettings(createDataClient(), {
        workspaceId,
        signaturePolicy: { meanings, reauth: 'every' },
      }),
    onSuccess: () => {
      onSaved()
      toast(t('settings.signatures.signaturePolicySavedToast'))
    },
    onError: (error: unknown) =>
      toast(t('settings.signatures.couldSavePolicyToast'), {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  return (
    <Section
      title={t('settings.signatures.workspacePolicy')}
      count={
        canManage ? (
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {t('common.actions.saveChanges')}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2.5">
        {(['Authored', 'Witnessed', 'Reviewed', 'Approved'] as const).map(
          (m) => (
            <CheckRow
              key={m}
              title={`${m} is a signature meaning in use`}
              body={
                m === 'Authored'
                  ? 'Always on: every record needs its author’s signature before review.'
                  : m === 'Witnessed'
                    ? 'Someone who saw the work done signs other people’s records when asked.'
                    : undefined
              }
              checked={meanings[m] ?? false}
              disabled={!canManage || m === 'Authored'}
              onCheckedChange={(on) =>
                setMeanings((current) => ({ ...current, [m]: on }))
              }
            />
          ),
        )}
      </div>
      <Muted className="mt-3">
        Password re-entry is required for every signature. Three consecutive
        failed attempts lock signing for 15 minutes.
      </Muted>
      <Muted className="mt-2">
        {t('settings.signatures.signatureAlwaysRecords')}
      </Muted>
    </Section>
  )
}

/** The statement everyone certifies. Wording it afresh raises its version and
 * asks everyone to certify again; certifications already made keep the version
 * they agreed to. */
function StatementSection({
  workspaceId,
  canManage,
  onSaved,
}: {
  workspaceId: string
  canManage: boolean
  onSaved: () => void
}) {
  const queryClient = useQueryClient()
  const statement = useQuery({
    queryKey: signatureStatementQueryKeys.workspace(workspaceId),
    queryFn: () =>
      fetchSignatureStatement(signatureCertificationDataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  const [draft, setDraft] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const current = statement.data
  const text = draft ?? current?.text ?? ''
  const changed = current != null && text.trim() !== current.text
  const valid = text.trim().length >= 20 && text.trim().length <= 2000
  const save = useMutation({
    mutationFn: () =>
      updateSignatureStatement(
        signatureCertificationDataClient,
        workspaceId,
        text,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: signatureStatementQueryKeys.workspace(workspaceId),
      })
      setDraft(null)
      setConfirming(false)
      onSaved()
      toast('Certification statement saved')
    },
    onError: (error: unknown) =>
      toast('Could not save the statement', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })
  return (
    <Section
      title="Certification statement"
      count={current ? `Version ${current.version}` : undefined}
    >
      <p className="m-0 text-label text-fg-muted">
        What each person agrees to when they certify their signature.
      </p>
      <textarea
        aria-label="Certification statement"
        rows={4}
        value={text}
        disabled={!canManage || !current}
        onChange={(e) => {
          setDraft(e.target.value)
          setConfirming(false)
        }}
        className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-body text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-default disabled:bg-surface-disabled disabled:text-fg-muted"
      />
      {canManage && changed ? (
        confirming ? (
          <Notice
            tone="warn"
            action={
              <Button
                variant="primary"
                disabled={save.isPending || !valid}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Saving…' : 'Save new version'}
              </Button>
            }
          >
            Everyone will need to certify again before they can sign.
            Certifications already made keep the version they agreed to.
          </Notice>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={!valid}
              onClick={() => setConfirming(true)}
            >
              Save statement
            </Button>
            <Button onClick={() => setDraft(null)}>Discard</Button>
          </div>
        )
      ) : null}
      {!valid && changed ? (
        <Muted>The statement needs 20 to 2000 characters.</Muted>
      ) : null}
    </Section>
  )
}

function IdentityVerification({
  userId,
  name,
  onVerified,
}: {
  userId: string
  name: string
  onVerified: () => void
}) {
  const [email, setEmail] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const verify = useMutation({
    mutationFn: () =>
      verifySignatureIdentity(signatureCertificationDataClient, userId, email),
    onSuccess: onVerified,
  })
  return (
    <Collapsible className="w-full">
      <CollapsibleTrigger>
        {t('settings.signatures.verifyIndependently', { name })}
      </CollapsibleTrigger>
      <CollapsiblePanel className="mt-2 flex flex-col gap-2">
        <Field label={t('settings.signatures.independentlyVerifiedEmail')}>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-body">
          <Checkbox
            checked={confirmed}
            onCheckedChange={(value) => setConfirmed(Boolean(value))}
          />
          {t('settings.signatures.iIndependentlyConfirmed')}
        </label>
        <Button
          disabled={!email || !confirmed || verify.isPending}
          onClick={() => verify.mutate()}
        >
          {t('settings.signatures.confirmVerifiedIdentity')}
        </Button>
        {verify.error ? (
          <Notice tone="bad">{verify.error.message}</Notice>
        ) : null}
      </CollapsiblePanel>
    </Collapsible>
  )
}
