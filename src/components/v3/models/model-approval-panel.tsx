import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Banner, Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field } from '#/components/v3/ui/input'
import { Muted } from '#/components/v3/ui/layout'
import { Textarea } from '#/components/v3/inventory/list'
import { toast } from '#/components/v3/ui/sonner'
import {
  DATASET_SCHEMA_VERSION_KIND,
  approveApprovalRequest,
  returnApprovalRequest,
  submitApprovalRequest,
  withdrawApprovalRequest,
} from '#/lib/approval-requests'
import type { ApprovalRequest } from '#/lib/approval-requests'
import type { CanonicalDatasetSchemaVersion } from '#/lib/dataset-schema-definition-rpc'
import type { DataClient } from '#/lib/data-client'
import { formatNotebookDateTime, notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import {
  APPROVAL_REASON_MAX,
  APPROVER_ROLE_OPTIONS,
  DEFAULT_APPROVER_ROLES,
  approvalActorIds,
  approvalStatus,
  buildApprovalTrail,
  canDecide,
  canSubmitForApproval,
  canWithdraw,
  latestRequest,
  normaliseReason,
  pendingRequest,
  roleList,
} from './model-approval'
import type {
  ApprovalDecision,
  ApprovalTrailEntry,
  ApproverRole,
} from './model-approval'

/**
 * MDL-03.3 — the SchemaPending / PromoteRejected board for one model version.
 *
 * Shows the live approval state (pending lock, returned reason, withdrawn,
 * approved), the named approver roles and who submitted it, the audit trail,
 * and the actions this user may take. Every action goes through the generic
 * `api.approval_requests` RPCs; the panel never writes the tables and treats
 * its own role gating as a hint — the server re-checks role and independence.
 */

export interface ModelApprovalPanelProps {
  version: CanonicalDatasetSchemaVersion
  publishedVersion: number | null
  requests: ApprovalRequest[]
  decisions: ApprovalDecision[]
  role: string | null | undefined
  user: { id: string; name: string } | null
  workspaceId: string | null | undefined
  client?: DataClient
  className?: string
}

const TRAIL_LABEL: Record<ApprovalTrailEntry['kind'], string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  returned: 'Returned',
  withdrawn: 'Withdrawn',
}

const TRAIL_TONE: Record<ApprovalTrailEntry['kind'], Tone> = {
  submitted: 'none',
  approved: 'ok',
  returned: 'bad',
  withdrawn: 'stored',
}

type PanelDialog = 'submit' | 'withdraw' | 'approve' | 'return'

function errorToast(title: string) {
  return (cause: unknown) =>
    toast(title, {
      description: cause instanceof Error ? cause.message : 'Please try again.',
    })
}

export function ModelApprovalPanel({
  version,
  publishedVersion,
  requests,
  decisions,
  role,
  user,
  workspaceId,
  client = notebookDataClient,
  className,
}: ModelApprovalPanelProps) {
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<PanelDialog | null>(null)

  const pending = pendingRequest(requests)
  const latest = latestRequest(requests)
  const status = approvalStatus(requests, version.revision)
  const isDraft = version.lifecycle === 'draft'
  const canSubmit = isDraft && !pending && canSubmitForApproval(role)
  const canDecideNow = canDecide(pending, user?.id, role)
  const canWithdrawNow = canWithdraw(pending, user?.id, role)

  const actorIds = useMemo(
    () => approvalActorIds(requests, decisions),
    [requests, decisions],
  )
  const { userLabel } = useUserNames(actorIds, user ?? undefined)

  const trail = useMemo(() => {
    const chronological = [...requests].sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
    )
    return chronological.flatMap((request) =>
      buildApprovalTrail(request, decisions),
    )
  }, [requests, decisions])

  const actorLabel = (id: string | null | undefined): string =>
    id ? userLabel(id) : 'A workspace member'

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['ui-port', 'models'] })
  }

  const submit = useMutation({
    mutationFn: (input: {
      reason: string
      roles: ApproverRole[]
      independent: boolean
    }) =>
      submitApprovalRequest(client, {
        workspaceId: workspaceId as string,
        objectKind: DATASET_SCHEMA_VERSION_KIND,
        objectId: version.id,
        objectRevision: version.revision,
        requiredApproverRoles: input.roles,
        reason: input.reason,
        requireIndependence: input.independent,
      }),
    onSuccess: (_created, input) => {
      setDialog(null)
      invalidate()
      toast('Submitted for approval', {
        description: `An approver in ${roleList(
          input.roles,
        )} has been asked to review v${version.version}.`,
      })
    },
    onError: errorToast('Could not submit for approval'),
  })

  const withdraw = useMutation({
    mutationFn: (reason: string) =>
      withdrawApprovalRequest(client, pending!.id, reason || undefined),
    onSuccess: () => {
      setDialog(null)
      invalidate()
      toast('Submission withdrawn')
    },
    onError: errorToast('Could not withdraw the submission'),
  })

  const approve = useMutation({
    mutationFn: (reason: string) =>
      approveApprovalRequest(client, pending!.id, reason || undefined),
    onSuccess: () => {
      setDialog(null)
      invalidate()
      toast('Approved', {
        description: `v${version.version} can be published.`,
      })
    },
    onError: errorToast('Could not approve the submission'),
  })

  const returnForChanges = useMutation({
    mutationFn: (reason: string) =>
      returnApprovalRequest(client, pending!.id, reason),
    onSuccess: () => {
      setDialog(null)
      invalidate()
      toast('Returned to the submitter', {
        description: 'Draft v' + version.version + ' stays unpublished.',
      })
    },
    onError: errorToast('Could not return the submission'),
  })

  const busy =
    submit.isPending ||
    withdraw.isPending ||
    approve.isPending ||
    returnForChanges.isPending

  return (
    <section
      aria-label={`Approval for v${version.version}`}
      className={className}
    >
      {pending ? (
        <Banner
          tone="review"
          icon="lock"
          title={`Locked while ${roleList(pending.required_approver_roles)} reviews.`}
          action={
            <>
              {canWithdrawNow ? (
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={busy}
                  onClick={() => setDialog('withdraw')}
                >
                  Withdraw submission
                </Button>
              ) : null}
              {canDecideNow ? (
                <>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => setDialog('return')}
                  >
                    Return
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy}
                    onClick={() => setDialog('approve')}
                  >
                    Approve v{version.version}
                  </Button>
                </>
              ) : null}
            </>
          }
        >
          {actorLabel(pending.submitted_by_user_id)} submitted{' '}
          {formatNotebookDateTime(pending.submitted_at)}.{' '}
          {publishedVersion != null
            ? `v${publishedVersion} stays current until approved.`
            : 'Nothing is published until this is approved.'}
        </Banner>
      ) : latest?.state === 'returned' ? (
        <Notice
          tone="bad"
          icon="warn"
          title={`Returned by ${actorLabel(
            latest.decided_by_user_id,
          )} on ${formatNotebookDateTime(latest.decided_at)}.`}
          action={
            canSubmit ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => setDialog('submit')}
              >
                Edit and resubmit
              </Button>
            ) : null
          }
        >
          {latest.decision_reason ? (
            <span>“{latest.decision_reason}” </span>
          ) : null}
          <span className="text-fg-muted">
            Draft v{version.version} stays unpublished and nothing changed.
          </span>
        </Notice>
      ) : latest?.state === 'withdrawn' ? (
        <Notice
          tone="info"
          icon="info"
          title={`Submission withdrawn by ${actorLabel(
            latest.decided_by_user_id,
          )} on ${formatNotebookDateTime(latest.decided_at)}.`}
          action={
            canSubmit ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => setDialog('submit')}
              >
                Submit for approval
              </Button>
            ) : null
          }
        >
          {latest.decision_reason ? (
            <span>“{latest.decision_reason}” </span>
          ) : (
            <span>It can be submitted again. </span>
          )}
          <span className="text-fg-muted">
            {publishedVersion != null
              ? `v${publishedVersion} stays current.`
              : 'Nothing is published yet.'}
          </span>
        </Notice>
      ) : latest?.state === 'approved' &&
        latest.object_revision !== version.revision &&
        isDraft ? (
        <Notice
          tone="info"
          title="The draft changed after approval."
          action={
            canSubmit ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => setDialog('submit')}
              >
                Submit for approval
              </Button>
            ) : null
          }
        >
          The current revision needs a new approval request before publication.
        </Notice>
      ) : latest?.state === 'approved' ? (
        <Notice
          tone="info"
          icon="check"
          title={`Approved by ${actorLabel(
            latest.decided_by_user_id,
          )} on ${formatNotebookDateTime(latest.decided_at)}.`}
        >
          <span className="text-fg-muted">
            {isDraft
              ? `Publish v${version.version} when you are ready.`
              : `v${version.version} is published.`}
          </span>
        </Notice>
      ) : (
        <Notice
          tone="info"
          icon="info"
          title="Not submitted for approval."
          action={
            canSubmit ? (
              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={() => setDialog('submit')}
              >
                Submit for approval
              </Button>
            ) : null
          }
        >
          <span className="text-fg-muted">
            {isDraft
              ? 'Name the roles that must approve this version before it can be published.'
              : 'This version was published without an approval request.'}
          </span>
        </Notice>
      )}

      <div className="flex flex-col gap-3 px-4 pb-1 pt-3 md:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Status tone={status.tone}>{status.label}</Status>
          <Muted>{status.detail}</Muted>
          {latest ? (
            <Muted>
              Required: {roleList(latest.required_approver_roles)}
              {latest.require_independence
                ? ' · independent approver'
                : ' · submitter may approve'}
            </Muted>
          ) : null}
        </div>

        {trail.length ? (
          <div>
            <h2 className="mb-1 text-section">Approval trail</h2>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {trail.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline gap-x-2 text-label"
                >
                  <Status tone={TRAIL_TONE[entry.kind]}>
                    {TRAIL_LABEL[entry.kind]}
                  </Status>
                  <span className="text-fg">
                    {actorLabel(entry.actorUserId)}
                  </span>
                  {entry.role ? (
                    <span className="text-fg-muted">· {entry.role}</span>
                  ) : null}
                  <span className="text-fg-muted">
                    {formatNotebookDateTime(entry.at)}
                  </span>
                  {entry.reason ? (
                    <span className="max-w-full whitespace-normal text-fg-muted">
                      “{entry.reason}”
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Muted>No approval activity yet.</Muted>
        )}
      </div>

      <SubmitDialog
        open={dialog === 'submit'}
        busy={busy}
        defaultRoles={DEFAULT_APPROVER_ROLES}
        onOpenChange={(open) => setDialog(open ? 'submit' : null)}
        onSubmit={(input) => submit.mutate(input)}
      />
      <ReasonDialog
        open={dialog === 'withdraw'}
        busy={busy}
        title="Withdraw submission"
        description={`v${version.version} stops awaiting approval and returns to draft.`}
        label="Reason (optional)"
        required={false}
        confirmLabel="Withdraw"
        onOpenChange={(open) => setDialog(open ? 'withdraw' : null)}
        onConfirm={(reason) => withdraw.mutate(reason)}
      />
      <ReasonDialog
        open={dialog === 'approve'}
        busy={busy}
        title={`Approve v${version.version}`}
        description="The version can then be published. Your role and independence are checked again."
        label="Note (optional)"
        required={false}
        confirmLabel="Approve"
        onOpenChange={(open) => setDialog(open ? 'approve' : null)}
        onConfirm={(reason) => approve.mutate(reason)}
      />
      <ReasonDialog
        open={dialog === 'return'}
        busy={busy}
        title={`Return v${version.version}`}
        description="The submitter sees your reason and can edit the draft and resubmit."
        label="Reason for returning"
        required
        confirmLabel="Return for changes"
        onOpenChange={(open) => setDialog(open ? 'return' : null)}
        onConfirm={(reason) => returnForChanges.mutate(reason)}
      />
    </section>
  )
}

function SubmitDialog({
  open,
  busy,
  defaultRoles,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  busy: boolean
  defaultRoles: ApproverRole[]
  onOpenChange: (open: boolean) => void
  onSubmit: (input: {
    reason: string
    roles: ApproverRole[]
    independent: boolean
  }) => void
}) {
  const [reason, setReason] = useState('')
  const [roles, setRoles] = useState<ApproverRole[]>(defaultRoles)
  const [independent, setIndependent] = useState(true)

  const validReason = normaliseReason(reason) !== null
  const valid = validReason && roles.length > 0

  function reset() {
    setReason('')
    setRoles(defaultRoles)
    setIndependent(true)
  }

  function toggleRole(role: ApproverRole) {
    setRoles((current) =>
      current.includes(role)
        ? current.filter((item) => item !== role)
        : [...current, role],
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title="Submit for approval"
          description="The draft is locked while it waits; the published version stays in use."
        />
        <DialogBody>
          <Field label="Reason" required>
            <Textarea
              value={reason}
              rows={3}
              maxLength={APPROVAL_REASON_MAX}
              disabled={busy}
              placeholder="What changed and why it needs review"
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-label font-medium text-fg">
              Approver roles
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {APPROVER_ROLE_OPTIONS.map((role) => (
                <label
                  key={role}
                  className="flex cursor-pointer items-center gap-2 text-label text-fg"
                >
                  <input
                    type="checkbox"
                    checked={roles.includes(role)}
                    disabled={busy}
                    onChange={() => toggleRole(role)}
                  />
                  {role === 'reviewer' ? 'Reviewer (QA)' : role}
                </label>
              ))}
            </div>
            {roles.length === 0 ? (
              <span className="text-danger-text">
                Name at least one approver role.
              </span>
            ) : null}
          </fieldset>
          <label className="flex cursor-pointer items-center gap-2 text-label text-fg">
            <input
              type="checkbox"
              checked={independent}
              disabled={busy}
              onChange={(event) => setIndependent(event.target.checked)}
            />
            Require an independent approver (the submitter cannot approve)
          </label>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={!valid || busy}
            onClick={() =>
              onSubmit({
                reason: normaliseReason(reason) ?? '',
                roles,
                independent,
              })
            }
          >
            {busy ? 'Submitting…' : 'Submit for approval'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReasonDialog({
  open,
  busy,
  title,
  description,
  label,
  required,
  confirmLabel,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  busy: boolean
  title: string
  description: string
  label: string
  required: boolean
  confirmLabel: string
  onOpenChange: (open: boolean) => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const trimmed = reason.trim()
  const valid = !required || normaliseReason(reason) !== null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason('')
        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader title={title} description={description} />
        <DialogBody>
          <Field label={label} required={required}>
            <Textarea
              value={reason}
              rows={3}
              maxLength={APPROVAL_REASON_MAX}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={!valid || busy}
            onClick={() => onConfirm(trimmed)}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
