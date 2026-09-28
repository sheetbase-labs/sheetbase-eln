import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Muted, Section } from '#/components/v3/ui/layout'
import { toast } from '#/components/v3/ui/sonner'
import {
  CheckRow,
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import { createDataClient } from '#/lib/data-client'
import { hasCapability } from '#/lib/capability'
import {
  adminQueryKeys,
  fetchWorkspaceSettings,
  updateWorkspaceSettings,
} from '#/lib/workspace-admin'
import {
  SIGNATURE_STATEMENT,
  SIGNATURE_STATEMENT_VERSION,
  certifySignature,
  fetchWorkspaceCertifications,
  isCurrentStatement,
  readSignaturePolicy,
  signatureCertificationDataClient,
  signatureCertificationQueryKeys,
  withdrawSignatureCertification,
} from '#/lib/signature-certification'
import type { SignaturePolicy } from '#/lib/signature-certification'

/** UI port (roadmap-4/ui-app3): electronic signatures. You certify your own
 * signature for the workspace; owners and admins set the workspace policy.
 * Certification is a per-user attestation (SIGN-003), never a record write. */
export const Route = createFileRoute('/settings/signatures')({
  component: Signatures,
})

const dataClient = createDataClient()

function Signatures() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const canManage = hasCapability(context.workspace?.role, 'workspace.admin')
  const queryClient = useQueryClient()
  const [agreed, setAgreed] = useState(false)

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

  const mine = (certifications.data ?? []).find(
    (c) => c.userId === context.user.id,
  )
  const current = isCurrentStatement(mine)
  const uncertified = (certifications.data ?? []).filter(
    (c) => !(c.certifiedAt && !c.revokedAt),
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

  const certify = useMutation({
    mutationFn: () =>
      certifySignature(
        signatureCertificationDataClient,
        workspaceId,
        SIGNATURE_STATEMENT_VERSION,
      ),
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
      <SettingsHeader title="Electronic signatures">
        {context.workspace?.name ?? 'Workspace'} · signatures are a deliberate
        act; every one records who, when and what version
      </SettingsHeader>
      <SettingsBody>
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
                Certified {mine?.certifiedAt?.slice(0, 10)} against statement
                version {mine?.statementVersion}.
              </p>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  disabled={withdraw.isPending}
                  onClick={() => withdraw.mutate()}
                >
                  Withdraw certification
                </Button>
              </div>
            </div>
          ) : (
            <>
              {mine?.certifiedAt ? (
                <p className="m-0 mb-2 text-label text-warning-text">
                  The statement changed since you certified (version{' '}
                  {mine.statementVersion}); certify again to accept it.
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
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  disabled={!agreed || certify.isPending}
                  onClick={() => certify.mutate()}
                >
                  Certify signature
                </Button>
                {!agreed ? (
                  <span className="text-label text-fg-muted">
                    Agree to the statement to continue
                  </span>
                ) : null}
              </div>
            </>
          )}
        </Section>

        <PolicySection
          policy={policy}
          canManage={canManage}
          workspaceId={workspaceId}
          onSaved={invalidate}
        />

        <Section
          title="People without a certified signature"
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
                    · cannot author, review or approve until certified
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Muted>
              Everyone in the workspace has certified their signature.
            </Muted>
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
  const [reauth, setReauth] = useState<SignaturePolicy['reauth']>(policy.reauth)

  const save = useMutation({
    mutationFn: () =>
      updateWorkspaceSettings(createDataClient(), {
        workspaceId,
        signaturePolicy: { meanings, reauth },
      }),
    onSuccess: () => {
      onSaved()
      toast('Signature policy saved')
    },
    onError: (error: unknown) =>
      toast('Could not save the policy', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  return (
    <Section
      title="Workspace policy"
      count={
        canManage ? (
          <Button
            size="sm"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            Save changes
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2.5">
        {(['Authored', 'Reviewed', 'Approved'] as const).map((m) => (
          <CheckRow
            key={m}
            title={`${m} is a signature meaning in use`}
            body={
              m === 'Authored'
                ? 'Always on: every record needs its author’s signature before review.'
                : undefined
            }
            checked={meanings[m] ?? false}
            disabled={!canManage || m === 'Authored'}
            onCheckedChange={(on) =>
              setMeanings((current) => ({ ...current, [m]: on }))
            }
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(['every', 'batch'] as const).map((mode) => (
          <Button
            key={mode}
            size="sm"
            variant={reauth === mode ? 'primary' : 'secondary'}
            disabled={!canManage}
            onClick={() => setReauth(mode)}
          >
            {mode === 'every'
              ? 'Password at every signature'
              : 'Password once per 15-minute signing session'}
          </Button>
        ))}
      </div>
      <Muted className="mt-2">
        A signature always records the signer, the server time, the meaning and
        the exact version it applies to. Signed records are locked; changes need
        an amendment and a new review.
      </Muted>
    </Section>
  )
}
