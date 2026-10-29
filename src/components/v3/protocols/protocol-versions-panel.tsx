import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Banner } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field } from '#/components/v3/ui/input'
import { Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { toast } from '#/components/v3/ui/sonner'
import { TableBox } from '#/components/v3/ui/table'
import { Textarea } from '#/components/v3/inventory/list'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { useModelApprovalIndex } from '#/components/v3/models/model-approval-data'
import { ReasonDialog } from '#/components/v3/models/model-approval-panel'
import {
  canDecide,
  canWithdraw,
  isWorkspaceWriter,
  latestRequest,
  pendingRequest,
  roleLabel,
} from '#/components/v3/models/model-approval'
import {
  PROTOCOL_REVISION_KIND,
  fetchProtocolVersions,
} from '#/lib/controlled-protocols'
import type { ProtocolVersion } from '#/lib/controlled-protocols'
import {
  withdrawApprovalRequest,
  returnApprovalRequest,
} from '#/lib/approval-requests'
import {
  approveProtocolRevision,
  chainStage,
  makeProtocolVersionEffective,
  stageRoles,
  submitProtocolRevision,
} from '#/lib/protocol-revisions'
import { formatNotebookDateTime, notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { t } from '#/copy'

export const protocolVersionsKey = (protocolRecordId: string) =>
  ['ui-port', 'protocol-versions', protocolRecordId] as const

const STATUS: Record<ProtocolVersion['status'], { tone: Tone; label: string }> =
  {
    draft: {
      tone: 'draft',
      label: t('library.protocols.protocolVersionsPanel.draft'),
    },
    in_review: {
      tone: 'review',
      label: t('library.protocols.protocolVersionsPanel.inReview'),
    },
    effective: {
      tone: 'ok',
      label: t('library.protocols.protocolVersionsPanel.effective'),
    },
    superseded: {
      tone: 'stored',
      label: t('library.protocols.protocolVersionsPanel.superseded'),
    },
    retired: {
      tone: 'stored',
      label: t('library.protocols.protocolVersionsPanel.retired'),
    },
  }

type RowDialog =
  | { kind: 'approve' | 'return' | 'withdraw'; version: ProtocolVersion }
  | { kind: 'submit'; resume?: ProtocolVersion }

/**
 * The protocol's one list of versions: each is a frozen copy of the text with
 * its own approval chain. Submitting freezes the current text, the chain
 * (technical review, then QA) approves it, and the last approval makes it the
 * effective version, which the next experiment starts from.
 */
export function ProtocolVersionsPanel({
  protocolRecordId,
  workspaceId,
  role,
  user,
}: {
  protocolRecordId: string
  workspaceId: string | null | undefined
  role: string | null | undefined
  user: { id: string; name: string } | null
}) {
  const client = notebookDataClient
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<RowDialog | null>(null)
  const versions = useQuery({
    queryKey: protocolVersionsKey(protocolRecordId),
    queryFn: () => fetchProtocolVersions(client, protocolRecordId),
  })
  const rows = versions.data ?? []
  const approvals = useModelApprovalIndex(
    rows.map((v) => v.id),
    client,
    PROTOCOL_REVISION_KIND,
  )
  const names = useUserNames(
    rows.map((v) => v.created_by_user_id),
    user ?? undefined,
  )
  const writer = isWorkspaceWriter(role)
  const effective = rows.find((v) => v.status === 'effective')
  const inFlight = rows.find(
    (v) => v.status === 'draft' || v.status === 'in_review',
  )

  function refresh() {
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'protocol-versions'],
    })
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'models', 'approval-index'],
    })
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'protocol-acknowledgements'],
    })
  }
  const failed = (title: string) => (cause: unknown) =>
    toast(title, {
      description:
        cause instanceof Error
          ? cause.message
          : t('library.protocols.protocolVersionsPanel.pleaseTryAgain'),
    })

  const submit = useMutation({
    mutationFn: (input: { summary: string; resume?: ProtocolVersion }) =>
      submitProtocolRevision(client, {
        workspaceId: workspaceId ?? '',
        protocolRecordId,
        changeSummary: input.summary,
        existingVersion: input.resume,
      }),
    onSuccess: () => {
      setDialog(null)
      refresh()
      toast(t('library.protocols.protocolVersionsPanel.submittedForReview'), {
        description: t(
          'library.protocols.protocolVersionsPanel.aScientistOrStewardReviews',
        ),
      })
    },
    onError: failed(
      t('library.protocols.protocolVersionsPanel.couldNotSubmitTheVersion'),
    ),
  })
  const approve = useMutation({
    mutationFn: (input: {
      version: ProtocolVersion
      requestId: string
      reason: string
    }) =>
      approveProtocolRevision(client, {
        requestId: input.requestId,
        versionId: input.version.id,
        reason: input.reason || undefined,
      }),
    onSuccess: (result, input) => {
      setDialog(null)
      refresh()
      if (result.effective) {
        toast(
          t('library.protocols.protocolVersionsPanel.vIsNowEffective', {
            version: input.version.version,
          }),
          {
            description: t(
              'library.protocols.protocolVersionsPanel.newExperimentsStartFromIt',
            ),
          },
        )
      } else if (result.releaseError) {
        toast(
          t(
            'library.protocols.protocolVersionsPanel.approvedButNotYetEffective',
          ),
          {
            description: t(
              'library.protocols.protocolVersionsPanel.useMakeEffectiveOnThis',
              { releaseError: result.releaseError },
            ),
          },
        )
      } else {
        toast(t('library.protocols.protocolVersionsPanel.approvalRecorded'), {
          description: t(
            'library.protocols.protocolVersionsPanel.qaApprovesNextTheLast',
          ),
        })
      }
    },
    onError: failed(
      t('library.protocols.protocolVersionsPanel.couldNotApprove'),
    ),
  })
  const returnBack = useMutation({
    mutationFn: (input: { requestId: string; reason: string }) =>
      returnApprovalRequest(client, input.requestId, input.reason),
    onSuccess: () => {
      setDialog(null)
      refresh()
      toast(t('library.protocols.protocolVersionsPanel.returnedToTheAuthor'))
    },
    onError: failed(
      t('library.protocols.protocolVersionsPanel.couldNotReturnTheVersion'),
    ),
  })
  const withdraw = useMutation({
    mutationFn: (input: { requestId: string; reason: string }) =>
      withdrawApprovalRequest(
        client,
        input.requestId,
        input.reason || undefined,
      ),
    onSuccess: () => {
      setDialog(null)
      refresh()
      toast(t('library.protocols.protocolVersionsPanel.submissionWithdrawn'))
    },
    onError: failed(
      t(
        'library.protocols.protocolVersionsPanel.couldNotWithdrawTheSubmission',
      ),
    ),
  })
  const release = useMutation({
    mutationFn: (version: ProtocolVersion) =>
      makeProtocolVersionEffective(client, version.id),
    onSuccess: (version) => {
      refresh()
      toast(
        t('library.protocols.protocolVersionsPanel.vIsNowEffective', {
          version: version.version,
        }),
      )
    },
    onError: failed(
      t('library.protocols.protocolVersionsPanel.couldNotMakeItEffective'),
    ),
  })

  const busy =
    submit.isPending ||
    approve.isPending ||
    returnBack.isPending ||
    withdraw.isPending ||
    release.isPending

  function approvalFor(version: ProtocolVersion) {
    const requests = approvals.data?.byVersion.get(version.id) ?? []
    const decisions = requests.flatMap(
      (r) => approvals.data?.byRequest.get(r.id) ?? [],
    )
    const pending = pendingRequest(requests)
    const latest = latestRequest(requests)
    return { requests, decisions, pending, latest }
  }

  const columns: RegistryColumn<ProtocolVersion>[] = [
    {
      id: 'version',
      header: t('library.protocols.protocolVersionsPanel.version'),
      cell: ({ row }) => <span className="num">v{row.original.version}</span>,
      meta: {
        ...rightAligned<ProtocolVersion>().meta,
        cellClassName: 'num text-right',
      },
    },
    {
      id: 'status',
      header: t('library.protocols.protocolVersionsPanel.status'),
      cell: ({ row }) => {
        const s = STATUS[row.original.status]
        return <Status tone={s.tone}>{s.label}</Status>
      },
    },
    {
      id: 'change',
      header: t('library.protocols.protocolVersionsPanel.whatChanged'),
      cell: ({ row }) =>
        row.original.change_summary ||
        t('library.protocols.protocolVersionsPanel.noSummaryRecorded'),
    },
    {
      id: 'approval',
      header: t('library.protocols.protocolVersionsPanel.approval'),
      cell: ({ row }) => {
        const v = row.original
        const a = approvalFor(v)
        if (v.status === 'effective' || v.status === 'superseded') {
          return (
            <span className="text-fg-muted">
              {v.effective_at
                ? t('library.protocols.protocolVersionsPanel.effective2', {
                    effectiveAt: formatNotebookDateTime(v.effective_at),
                  })
                : t('library.protocols.protocolVersionsPanel.approved')}
            </span>
          )
        }
        if (v.status !== 'in_review' && v.status !== 'draft') {
          return (
            <span className="text-fg-muted">
              {t('library.protocols.protocolVersionsPanel.retired')}
            </span>
          )
        }
        if (a.pending) {
          const stage = chainStage(a.decisions, false)
          return (
            <span className="text-fg-muted">
              {stage === 'technical'
                ? t(
                    'library.protocols.protocolVersionsPanel.waitingForTechnicalReviewScientist',
                  )
                : t(
                    'library.protocols.protocolVersionsPanel.technicalReviewDoneWaitingFor',
                  )}
            </span>
          )
        }
        if (a.latest?.state === 'returned') {
          return (
            <span className="text-fg-muted">
              {t('library.protocols.protocolVersionsPanel.returned')}
              {a.latest.decision_reason ? `: ${a.latest.decision_reason}` : ''}
            </span>
          )
        }
        if (a.latest?.state === 'approved') {
          return (
            <span className="text-fg-muted">
              {t(
                'library.protocols.protocolVersionsPanel.approvedNotYetEffective',
              )}
            </span>
          )
        }
        return (
          <span className="text-fg-muted">
            {t('library.protocols.protocolVersionsPanel.notSubmitted')}
          </span>
        )
      },
    },
    {
      id: 'author',
      header: t('library.protocols.protocolVersionsPanel.author'),
      cell: ({ row }) => names.userLabel(row.original.created_by_user_id),
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'actions',
      header: () => (
        <span className="sr-only">
          {t('library.protocols.protocolVersionsPanel.actions')}
        </span>
      ),
      cell: ({ row }) => {
        const v = row.original
        const a = approvalFor(v)
        const stage = chainStage(a.decisions, false)
        const myTurn =
          a.pending !== null &&
          canDecide(a.pending, user?.id, role) &&
          Boolean(role && stageRoles(stage).includes(role))
        return (
          <span className="flex flex-wrap justify-end gap-1.5">
            {myTurn && a.pending ? (
              <>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => setDialog({ kind: 'return', version: v })}
                >
                  {t('library.protocols.protocolVersionsPanel.return')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  onClick={() => setDialog({ kind: 'approve', version: v })}
                >
                  {stage === 'qa'
                    ? t(
                        'library.protocols.protocolVersionsPanel.approveAndRelease',
                      )
                    : t('library.protocols.protocolVersionsPanel.approve')}
                </Button>
              </>
            ) : null}
            {a.pending && canWithdraw(a.pending, user?.id, role) ? (
              <Button
                size="sm"
                variant="quiet"
                disabled={busy}
                onClick={() => setDialog({ kind: 'withdraw', version: v })}
              >
                {t('library.protocols.protocolVersionsPanel.withdraw')}
              </Button>
            ) : null}
            {v.status === 'in_review' &&
            !a.pending &&
            a.latest?.state === 'approved' &&
            writer ? (
              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={() => release.mutate(v)}
              >
                {t('library.protocols.protocolVersionsPanel.makeEffective')}
              </Button>
            ) : null}
            {(v.status === 'draft' || v.status === 'in_review') &&
            !a.pending &&
            a.latest?.state !== 'approved' &&
            writer ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => setDialog({ kind: 'submit', resume: v })}
              >
                {t('library.protocols.protocolVersionsPanel.submitForApproval')}
              </Button>
            ) : null}
            {v.status === 'effective' ? (
              <Button
                size="sm"
                variant="primary"
                nativeButton={false}
                render={
                  <Link
                    to="/experiments/new"
                    search={{ protocol: protocolRecordId }}
                  />
                }
              >
                {t('library.protocols.protocolVersionsPanel.startExperiment')}
              </Button>
            ) : null}
            <Link
              to="/evidence/$revisionId"
              params={{ revisionId: v.id }}
              className="text-link self-center"
            >
              {t('library.protocols.protocolVersionsPanel.evidence')}
            </Link>
          </span>
        )
      },
      meta: rightAligned<ProtocolVersion>().meta,
    },
  ]

  const dialogVersion =
    dialog && dialog.kind !== 'submit' ? dialog.version : null
  const dialogRequest = dialogVersion
    ? approvalFor(dialogVersion).pending
    : null

  return (
    <Section
      title={t('library.protocols.protocolVersionsPanel.versions')}
      count={rows.length}
      action={
        writer && !inFlight ? (
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => setDialog({ kind: 'submit' })}
          >
            {t(
              'library.protocols.protocolVersionsPanel.submitTheCurrentTextAs',
            )}
          </Button>
        ) : undefined
      }
    >
      {effective ? (
        <Banner
          tone="info"
          icon="check"
          title={t(
            'library.protocols.protocolVersionsPanel.vIsTheEffectiveVersion',
            { version: effective.version },
          )}
        >
          {effective.effective_at
            ? t('library.protocols.protocolVersionsPanel.inEffectSince', {
                effectiveAt: formatNotebookDateTime(effective.effective_at),
              })
            : t(
                'library.protocols.protocolVersionsPanel.newExperimentsStartFromIt2',
              )}
        </Banner>
      ) : null}
      {versions.isPending ? (
        <p role="status">
          {t('library.protocols.protocolVersionsPanel.loadingVersions')}
        </p>
      ) : versions.isError ? (
        <p role="alert">
          {t(
            'library.protocols.protocolVersionsPanel.theProtocolVersionsCouldNot',
          )}
        </p>
      ) : rows.length ? (
        <TableBox>
          <RegistryGrid
            label={t(
              'library.protocols.protocolVersionsPanel.protocolVersions',
            )}
            rows={rows}
            columns={columns}
            getRowId={(v) => v.id}
            selectable={false}
          />
        </TableBox>
      ) : (
        <EmptyState
          icon="protocol"
          title={t('library.protocols.protocolVersionsPanel.noVersionYet')}
          description={t(
            'library.protocols.protocolVersionsPanel.writingTheProtocolDoesNot',
          )}
          action={
            writer ? (
              <Button
                variant="primary"
                onClick={() => setDialog({ kind: 'submit' })}
              >
                {t(
                  'library.protocols.protocolVersionsPanel.submitTheCurrentTextAs2',
                )}
              </Button>
            ) : undefined
          }
        />
      )}

      <SubmitDialog
        open={dialog?.kind === 'submit'}
        busy={submit.isPending}
        resume={dialog?.kind === 'submit' ? dialog.resume : undefined}
        onOpenChange={(open) => !open && setDialog(null)}
        onSubmit={(summary) =>
          submit.mutate({
            summary,
            resume: dialog?.kind === 'submit' ? dialog.resume : undefined,
          })
        }
      />
      <ReasonDialog
        open={dialog?.kind === 'approve'}
        busy={busy}
        title={t('library.protocols.protocolVersionsPanel.approveV', {
          version: dialogVersion?.version ?? '',
        })}
        description={t(
          'library.protocols.protocolVersionsPanel.yourRoleAndIndependenceAre',
        )}
        label={t('library.protocols.protocolVersionsPanel.noteOptional')}
        required={false}
        confirmLabel={t('library.protocols.protocolVersionsPanel.approve')}
        onOpenChange={(open) => !open && setDialog(null)}
        onConfirm={(reason) =>
          dialogVersion && dialogRequest
            ? approve.mutate({
                version: dialogVersion,
                requestId: dialogRequest.id,
                reason,
              })
            : undefined
        }
      />
      <ReasonDialog
        open={dialog?.kind === 'return'}
        busy={busy}
        title={t('library.protocols.protocolVersionsPanel.returnV', {
          version: dialogVersion?.version ?? '',
        })}
        description={t(
          'library.protocols.protocolVersionsPanel.theAuthorSeesYourReason',
        )}
        label={t('library.protocols.protocolVersionsPanel.reasonForReturning')}
        required
        confirmLabel={t(
          'library.protocols.protocolVersionsPanel.returnForChanges',
        )}
        onOpenChange={(open) => !open && setDialog(null)}
        onConfirm={(reason) =>
          dialogRequest
            ? returnBack.mutate({ requestId: dialogRequest.id, reason })
            : undefined
        }
      />
      <ReasonDialog
        open={dialog?.kind === 'withdraw'}
        busy={busy}
        title={t('library.protocols.protocolVersionsPanel.withdrawV', {
          version: dialogVersion?.version ?? '',
        })}
        description={t(
          'library.protocols.protocolVersionsPanel.theVersionStopsWaitingFor',
        )}
        label={t('library.protocols.protocolVersionsPanel.reasonOptional')}
        required={false}
        confirmLabel={t('library.protocols.protocolVersionsPanel.withdraw')}
        onOpenChange={(open) => !open && setDialog(null)}
        onConfirm={(reason) =>
          dialogRequest
            ? withdraw.mutate({ requestId: dialogRequest.id, reason })
            : undefined
        }
      />
      <p className="mt-2 text-caption text-fg-muted">
        {t('library.protocols.protocolVersionsPanel.approvers', {
          first: ['scientist', 'steward'].map(roleLabel).join(' or '),
          then: ['reviewer', 'admin', 'owner'].map(roleLabel).join(', '),
        })}
      </p>
    </Section>
  )
}

function SubmitDialog({
  open,
  busy,
  resume,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  busy: boolean
  resume?: ProtocolVersion
  onOpenChange: (open: boolean) => void
  onSubmit: (summary: string) => void
}) {
  const [summary, setSummary] = useState('')
  const text = summary.trim() || resume?.change_summary || ''
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSummary('')
        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={
            resume
              ? t(
                  'library.protocols.protocolVersionsPanel.submitVForApproval',
                  { version: resume.version },
                )
              : t('library.protocols.protocolVersionsPanel.submitANewVersion')
          }
          description={
            resume
              ? t(
                  'library.protocols.protocolVersionsPanel.thisVersionsTextIsAlready',
                )
              : t(
                  'library.protocols.protocolVersionsPanel.theProtocolsCurrentTextIs',
                )
          }
        />
        <DialogBody>
          <Field
            label={t('library.protocols.protocolVersionsPanel.whatChanged')}
            required
          >
            <Textarea
              value={summary}
              rows={3}
              maxLength={500}
              disabled={busy}
              placeholder={
                resume?.change_summary ||
                t('library.protocols.protocolVersionsPanel.whatChangedAndWhyIt')
              }
              onChange={(event) => setSummary(event.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!text || busy}
            onClick={() => onSubmit(text)}
          >
            {busy
              ? t('library.protocols.protocolVersionsPanel.submitting')
              : t('library.protocols.protocolVersionsPanel.submitForApproval')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
