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

export const protocolVersionsKey = (protocolRecordId: string) =>
  ['ui-port', 'protocol-versions', protocolRecordId] as const

const STATUS: Record<ProtocolVersion['status'], { tone: Tone; label: string }> =
  {
    draft: { tone: 'draft', label: 'Draft' },
    in_review: { tone: 'review', label: 'In review' },
    effective: { tone: 'ok', label: 'Effective' },
    superseded: { tone: 'stored', label: 'Superseded' },
    retired: { tone: 'stored', label: 'Retired' },
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
      description: cause instanceof Error ? cause.message : 'Please try again.',
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
      toast('Submitted for review', {
        description:
          'A scientist or steward reviews it first, then QA. Approving the last step makes it the effective version.',
      })
    },
    onError: failed('Could not submit the version'),
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
        toast(`v${input.version.version} is now effective`, {
          description:
            'New experiments start from it. Operators acknowledge it under Training.',
        })
      } else if (result.releaseError) {
        toast('Approved, but not yet effective', {
          description: `${result.releaseError} Use Make effective on this version.`,
        })
      } else {
        toast('Approval recorded', {
          description:
            'QA approves next; the last approval makes it effective.',
        })
      }
    },
    onError: failed('Could not approve'),
  })
  const returnBack = useMutation({
    mutationFn: (input: { requestId: string; reason: string }) =>
      returnApprovalRequest(client, input.requestId, input.reason),
    onSuccess: () => {
      setDialog(null)
      refresh()
      toast('Returned to the author')
    },
    onError: failed('Could not return the version'),
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
      toast('Submission withdrawn')
    },
    onError: failed('Could not withdraw the submission'),
  })
  const release = useMutation({
    mutationFn: (version: ProtocolVersion) =>
      makeProtocolVersionEffective(client, version.id),
    onSuccess: (version) => {
      refresh()
      toast(`v${version.version} is now effective`)
    },
    onError: failed('Could not make it effective'),
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
      header: 'Version',
      cell: ({ row }) => <span className="num">v{row.original.version}</span>,
      meta: {
        ...rightAligned<ProtocolVersion>().meta,
        cellClassName: 'num text-right',
      },
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const s = STATUS[row.original.status]
        return <Status tone={s.tone}>{s.label}</Status>
      },
    },
    {
      id: 'change',
      header: 'What changed',
      cell: ({ row }) => row.original.change_summary || 'No summary recorded',
    },
    {
      id: 'approval',
      header: 'Approval',
      cell: ({ row }) => {
        const v = row.original
        const a = approvalFor(v)
        if (v.status === 'effective' || v.status === 'superseded') {
          return (
            <span className="text-fg-muted">
              {v.effective_at
                ? `Effective ${formatNotebookDateTime(v.effective_at)}`
                : 'Approved'}
            </span>
          )
        }
        if (v.status !== 'in_review' && v.status !== 'draft') {
          return <span className="text-fg-muted">Retired</span>
        }
        if (a.pending) {
          const stage = chainStage(a.decisions, false)
          return (
            <span className="text-fg-muted">
              {stage === 'technical'
                ? 'Waiting for technical review (scientist or steward)'
                : 'Technical review done; waiting for QA (reviewer, admin or owner)'}
            </span>
          )
        }
        if (a.latest?.state === 'returned') {
          return (
            <span className="text-fg-muted">
              Returned
              {a.latest.decision_reason ? `: ${a.latest.decision_reason}` : ''}
            </span>
          )
        }
        if (a.latest?.state === 'approved') {
          return (
            <span className="text-fg-muted">Approved; not yet effective</span>
          )
        }
        return <span className="text-fg-muted">Not submitted</span>
      },
    },
    {
      id: 'author',
      header: 'Author',
      cell: ({ row }) => names.userLabel(row.original.created_by_user_id),
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
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
                  Return
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  onClick={() => setDialog({ kind: 'approve', version: v })}
                >
                  {stage === 'qa' ? 'Approve and release' : 'Approve'}
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
                Withdraw
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
                Make effective
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
                Submit for approval
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
                Start experiment
              </Button>
            ) : null}
            <Link
              to="/evidence/$revisionId"
              params={{ revisionId: v.id }}
              className="text-link self-center"
            >
              Evidence
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
      title="Versions"
      count={rows.length}
      action={
        writer && !inFlight ? (
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => setDialog({ kind: 'submit' })}
          >
            Submit the current text as a new version
          </Button>
        ) : undefined
      }
    >
      {effective ? (
        <Banner
          tone="info"
          icon="check"
          title={`v${effective.version} is the effective version.`}
        >
          New experiments start from it
          {effective.effective_at
            ? `, in effect since ${formatNotebookDateTime(effective.effective_at)}`
            : ''}
          .
        </Banner>
      ) : null}
      {versions.isPending ? (
        <p role="status">Loading versions…</p>
      ) : versions.isError ? (
        <p role="alert">The protocol versions could not be loaded.</p>
      ) : rows.length ? (
        <TableBox className="max-w-[1100px]">
          <RegistryGrid
            label="Protocol versions"
            rows={rows}
            columns={columns}
            getRowId={(v) => v.id}
            selectable={false}
          />
        </TableBox>
      ) : (
        <EmptyState
          icon="protocol"
          title="No version yet"
          description="Writing the protocol does not make it usable. Submit its text as a version: a scientist or steward reviews it, QA approves it, and the last approval makes it the effective version an experiment can start from."
          action={
            writer ? (
              <Button
                variant="primary"
                onClick={() => setDialog({ kind: 'submit' })}
              >
                Submit the current text as version 1
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
        title={`Approve v${dialogVersion?.version ?? ''}`}
        description="Your role and independence are checked again. The last approval makes this the effective version."
        label="Note (optional)"
        required={false}
        confirmLabel="Approve"
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
        title={`Return v${dialogVersion?.version ?? ''}`}
        description="The author sees your reason, edits the protocol and submits again."
        label="Reason for returning"
        required
        confirmLabel="Return for changes"
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
        title={`Withdraw v${dialogVersion?.version ?? ''}`}
        description="The version stops waiting for approval."
        label="Reason (optional)"
        required={false}
        confirmLabel="Withdraw"
        onOpenChange={(open) => !open && setDialog(null)}
        onConfirm={(reason) =>
          dialogRequest
            ? withdraw.mutate({ requestId: dialogRequest.id, reason })
            : undefined
        }
      />
      <p className="mt-2 text-caption text-fg-muted">
        Approvers: {['scientist', 'steward'].map(roleLabel).join(' or ')} first,
        then {['reviewer', 'admin', 'owner'].map(roleLabel).join(', ')}. The
        author cannot approve their own version.
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
              ? `Submit v${resume.version} for approval`
              : 'Submit a new version'
          }
          description={
            resume
              ? 'This version’s text is already frozen. Submitting asks the approval chain to review it.'
              : 'The protocol’s current text is frozen as the next version and sent for approval. Edits after this belong to the next version.'
          }
        />
        <DialogBody>
          <Field label="What changed" required>
            <Textarea
              value={summary}
              rows={3}
              maxLength={500}
              disabled={busy}
              placeholder={
                resume?.change_summary || 'What changed and why it needs review'
              }
              onChange={(event) => setSummary(event.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={!text || busy}
            onClick={() => onSubmit(text)}
          >
            {busy ? 'Submitting…' : 'Submit for approval'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
