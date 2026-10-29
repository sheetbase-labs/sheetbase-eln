import { useEffect, useMemo, useRef, useState } from 'react'
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
import { RECORD_MODEL_VERSION_KIND } from '#/lib/record-model-versions'
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
  roleLabel,
  roleList,
} from './model-approval'
import type {
  ApprovalDecision,
  ApprovalTrailEntry,
  ApproverRole,
} from './model-approval'
import { t } from '#/copy'

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
  version: Pick<
    CanonicalDatasetSchemaVersion,
    'id' | 'version' | 'revision' | 'lifecycle'
  >
  objectKind?:
    typeof DATASET_SCHEMA_VERSION_KIND | typeof RECORD_MODEL_VERSION_KIND
  publishedVersion: number | null
  requests: ApprovalRequest[]
  decisions: ApprovalDecision[]
  role: string | null | undefined
  user: { id: string; name: string } | null
  workspaceId: string | null | undefined
  client?: DataClient
  className?: string
  /**
   * R5-CONFIG-03: a page-owned counter. Incrementing it opens the submit dialog
   * from the page header, so the editor's primary action reaches the same
   * dialog and RPCs the panel owns instead of duplicating them.
   */
  submitToken?: number
}

const TRAIL_LABEL: Record<ApprovalTrailEntry['kind'], string> = {
  submitted: t('library.models.modelApprovalPanel.submitted'),
  approved: t('library.models.modelApprovalPanel.approved'),
  returned: t('library.models.modelApprovalPanel.returned'),
  withdrawn: t('library.models.modelApprovalPanel.withdrawn'),
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
      description:
        cause instanceof Error
          ? cause.message
          : t('library.models.modelApprovalPanel.pleaseTryAgain'),
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
  objectKind = DATASET_SCHEMA_VERSION_KIND,
  client = notebookDataClient,
  className,
  submitToken,
}: ModelApprovalPanelProps) {
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<PanelDialog | null>(null)
  const seenSubmitToken = useRef(0)

  const pending = pendingRequest(requests)
  const latest = latestRequest(requests)
  const status = approvalStatus(requests, version.revision)
  const isDraft = version.lifecycle === 'draft'
  const canSubmit = isDraft && !pending && canSubmitForApproval(role)
  const canDecideNow = canDecide(pending, user?.id, role)
  const canWithdrawNow = canWithdraw(pending, user?.id, role)
  const everyRole = objectKind === RECORD_MODEL_VERSION_KIND

  // A header action can ask for the submit dialog; the panel owns the dialog,
  // its approver/reason fields and the RPC. Token 0 is "nothing asked yet".
  useEffect(() => {
    if (!submitToken || submitToken === seenSubmitToken.current) return
    seenSubmitToken.current = submitToken
    if (canSubmit) setDialog('submit')
  }, [submitToken, canSubmit])
  const approvers = (roles: readonly string[]) =>
    everyRole ? roles.map(roleLabel).join(' and ') : roleList(roles)

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
    id ? userLabel(id) : t('library.models.modelApprovalPanel.aWorkspaceMember')

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['ui-port', 'models'] })
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'record-models'],
    })
  }

  const submit = useMutation({
    mutationFn: (input: {
      reason: string
      roles: ApproverRole[]
      independent: boolean
    }) =>
      submitApprovalRequest(client, {
        workspaceId: workspaceId as string,
        objectKind,
        objectId: version.id,
        objectRevision: version.revision,
        requiredApproverRoles: input.roles,
        reason: input.reason,
        requireIndependence: everyRole || input.independent,
        requiredApprovals: everyRole ? input.roles.length : 1,
      }),
    onSuccess: (_created, input) => {
      setDialog(null)
      invalidate()
      toast(t('library.models.modelApprovalPanel.submittedForApproval'), {
        description: t(
          'library.models.modelApprovalPanel.approvalRequestedFromForV',
          { roles: approvers(input.roles), version: version.version },
        ),
      })
    },
    onError: errorToast(
      t('library.models.modelApprovalPanel.couldNotSubmitForApproval'),
    ),
  })

  const withdraw = useMutation({
    mutationFn: (reason: string) =>
      withdrawApprovalRequest(client, pending!.id, reason || undefined),
    onSuccess: () => {
      setDialog(null)
      invalidate()
      toast(t('library.models.modelApprovalPanel.submissionWithdrawn'))
    },
    onError: errorToast(
      t('library.models.modelApprovalPanel.couldNotWithdrawTheSubmission'),
    ),
  })

  const approve = useMutation({
    mutationFn: (reason: string) =>
      approveApprovalRequest(client, pending!.id, reason || undefined),
    onSuccess: (request) => {
      setDialog(null)
      invalidate()
      toast(
        request.state === 'approved'
          ? t('library.models.modelApprovalPanel.approved')
          : t('library.models.modelApprovalPanel.approvalRecorded'),
        {
          description:
            request.state === 'approved'
              ? t('library.models.modelApprovalPanel.vCanBePublished', {
                  version: version.version,
                })
              : t(
                  'library.models.modelApprovalPanel.theVersionRemainsLockedUntil',
                ),
        },
      )
    },
    onError: errorToast(
      t('library.models.modelApprovalPanel.couldNotApproveTheSubmission'),
    ),
  })

  const returnForChanges = useMutation({
    mutationFn: (reason: string) =>
      returnApprovalRequest(client, pending!.id, reason),
    onSuccess: () => {
      setDialog(null)
      invalidate()
      toast(t('library.models.modelApprovalPanel.returnedToTheSubmitter'), {
        description: t(
          'library.models.modelApprovalPanel.draftVStaysUnpublished',
          {
            version: version.version,
          },
        ),
      })
    },
    onError: errorToast(
      t('library.models.modelApprovalPanel.couldNotReturnTheSubmission'),
    ),
  })

  const busy =
    submit.isPending ||
    withdraw.isPending ||
    approve.isPending ||
    returnForChanges.isPending

  return (
    <section
      aria-label={t('library.models.modelApprovalPanel.approvalForV', {
        version: version.version,
      })}
      className={className}
    >
      {pending ? (
        <Banner
          tone="review"
          icon="lock"
          title={
            everyRole
              ? t(
                  'library.models.modelApprovalPanel.lockedWhileAwaitingApprovalFrom',
                  {
                    roles: approvers(pending.required_approver_roles),
                  },
                )
              : t('library.models.modelApprovalPanel.lockedWhileReviews', {
                  roles: approvers(pending.required_approver_roles),
                })
          }
          action={
            <>
              {canWithdrawNow ? (
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={busy}
                  onClick={() => setDialog('withdraw')}
                >
                  {t('library.models.modelApprovalPanel.withdrawSubmission')}
                </Button>
              ) : null}
              {canDecideNow ? (
                <>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => setDialog('return')}
                  >
                    {t('library.models.modelApprovalPanel.return')}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy}
                    onClick={() => setDialog('approve')}
                  >
                    {t('library.models.modelApprovalPanel.approveV', {
                      version: version.version,
                    })}
                  </Button>
                </>
              ) : null}
            </>
          }
        >
          {t('library.models.modelApprovalPanel.submitted2', {
            name: actorLabel(pending.submitted_by_user_id),
            when: formatNotebookDateTime(pending.submitted_at),
          })}{' '}
          {publishedVersion != null
            ? t(
                'library.models.modelApprovalPanel.vStaysCurrentUntilApproved',
                { publishedVersion },
              )
            : t(
                'library.models.modelApprovalPanel.nothingIsPublishedUntilThis',
              )}
        </Banner>
      ) : latest?.state === 'returned' ? (
        <Notice
          tone="bad"
          icon="warn"
          title={t('library.models.modelApprovalPanel.returnedByOn', {
            name: actorLabel(latest.decided_by_user_id),
            when: formatNotebookDateTime(latest.decided_at),
          })}
          action={
            canSubmit ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => setDialog('submit')}
              >
                {t('library.models.modelApprovalPanel.editAndResubmit')}
              </Button>
            ) : null
          }
        >
          {latest.decision_reason ? (
            <span>“{latest.decision_reason}” </span>
          ) : null}
          <span className="text-fg-muted">
            {t('library.models.modelApprovalPanel.draftVStaysUnpublishedAnd', {
              version: version.version,
            })}
          </span>
        </Notice>
      ) : latest?.state === 'withdrawn' ? (
        <Notice
          tone="info"
          icon="info"
          title={t(
            'library.models.modelApprovalPanel.submissionWithdrawnByOn',
            {
              name: actorLabel(latest.decided_by_user_id),
              when: formatNotebookDateTime(latest.decided_at),
            },
          )}
          action={
            canSubmit ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => setDialog('submit')}
              >
                {t('library.models.modelApprovalPanel.submitForApproval')}
              </Button>
            ) : null
          }
        >
          {latest.decision_reason ? (
            <span>“{latest.decision_reason}” </span>
          ) : (
            <span>
              {t(
                'library.models.modelApprovalPanel.itCanBeSubmittedAgain',
              )}{' '}
            </span>
          )}
          <span className="text-fg-muted">
            {publishedVersion != null
              ? t('library.models.modelApprovalPanel.vStaysCurrent', {
                  publishedVersion,
                })
              : t('library.models.modelApprovalPanel.nothingIsPublishedYet')}
          </span>
        </Notice>
      ) : latest?.state === 'approved' &&
        latest.object_revision !== version.revision &&
        isDraft ? (
        <Notice
          tone="info"
          title={t(
            'library.models.modelApprovalPanel.theDraftChangedAfterApproval',
          )}
          action={
            canSubmit ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => setDialog('submit')}
              >
                {t('library.models.modelApprovalPanel.submitForApproval')}
              </Button>
            ) : null
          }
        >
          {t('library.models.modelApprovalPanel.theCurrentRevisionNeedsA')}
        </Notice>
      ) : latest?.state === 'approved' ? (
        <Notice
          tone="info"
          icon="check"
          title={t('library.models.modelApprovalPanel.approvedByOn', {
            name: actorLabel(latest.decided_by_user_id),
            when: formatNotebookDateTime(latest.decided_at),
          })}
        >
          <span className="text-fg-muted">
            {isDraft
              ? t('library.models.modelApprovalPanel.publishVWhenYouAre', {
                  version: version.version,
                })
              : t('library.models.modelApprovalPanel.vIsPublished', {
                  version: version.version,
                })}
          </span>
        </Notice>
      ) : (
        <Notice
          tone="info"
          icon="info"
          title={t('library.models.modelApprovalPanel.notSubmittedForApproval')}
          action={
            canSubmit ? (
              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={() => setDialog('submit')}
              >
                {t('library.models.modelApprovalPanel.submitForApproval')}
              </Button>
            ) : null
          }
        >
          <span className="text-fg-muted">
            {isDraft
              ? t('library.models.modelApprovalPanel.nameTheRolesThatMust')
              : t(
                  'library.models.modelApprovalPanel.thisVersionWasPublishedWithout',
                )}
          </span>
        </Notice>
      )}

      <div className="flex flex-col gap-3 px-4 pb-1 pt-3 md:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Status tone={status.tone}>{status.label}</Status>
          <Muted>{status.detail}</Muted>
          {latest ? (
            <Muted>
              {t('library.models.modelApprovalPanel.required', {
                roles: approvers(latest.required_approver_roles),
              })}
              {latest.require_independence
                ? t('library.models.modelApprovalPanel.independentApprover')
                : t('library.models.modelApprovalPanel.submitterMayApprove')}
            </Muted>
          ) : null}
        </div>

        {trail.length ? (
          <div>
            <h2 className="mb-1 text-section">
              {t('library.models.modelApprovalPanel.approvalTrail')}
            </h2>
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
          <Muted>
            {t('library.models.modelApprovalPanel.noApprovalActivityYet')}
          </Muted>
        )}
      </div>

      <SubmitDialog
        open={dialog === 'submit'}
        busy={busy}
        defaultRoles={DEFAULT_APPROVER_ROLES}
        requireIndependence={everyRole}
        onOpenChange={(open) => setDialog(open ? 'submit' : null)}
        onSubmit={(input) => submit.mutate(input)}
      />
      <ReasonDialog
        open={dialog === 'withdraw'}
        busy={busy}
        title={t('library.models.modelApprovalPanel.withdrawSubmission')}
        description={t(
          'library.models.modelApprovalPanel.vStopsAwaitingApprovalAnd',
          { version: version.version },
        )}
        label={t('library.models.modelApprovalPanel.reasonOptional')}
        required={false}
        confirmLabel={t('library.models.modelApprovalPanel.withdraw')}
        onOpenChange={(open) => setDialog(open ? 'withdraw' : null)}
        onConfirm={(reason) => withdraw.mutate(reason)}
      />
      <ReasonDialog
        open={dialog === 'approve'}
        busy={busy}
        title={t('library.models.modelApprovalPanel.approveV', {
          version: version.version,
        })}
        description={t('library.models.modelApprovalPanel.theVersionCanThenBe')}
        label={t('library.models.modelApprovalPanel.noteOptional')}
        required={false}
        confirmLabel={t('library.models.modelApprovalPanel.approve')}
        onOpenChange={(open) => setDialog(open ? 'approve' : null)}
        onConfirm={(reason) => approve.mutate(reason)}
      />
      <ReasonDialog
        open={dialog === 'return'}
        busy={busy}
        title={t('library.models.modelApprovalPanel.returnV', {
          version: version.version,
        })}
        description={t(
          'library.models.modelApprovalPanel.theSubmitterSeesYourReason',
        )}
        label={t('library.models.modelApprovalPanel.reasonForReturning')}
        required
        confirmLabel={t('library.models.modelApprovalPanel.returnForChanges')}
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
  requireIndependence,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  busy: boolean
  defaultRoles: ApproverRole[]
  requireIndependence: boolean
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
          title={t('library.models.modelApprovalPanel.submitForApproval')}
          description={t(
            'library.models.modelApprovalPanel.theDraftIsLockedWhile',
          )}
        />
        <DialogBody>
          <Field label={t('library.models.modelApprovalPanel.reason')} required>
            <Textarea
              value={reason}
              rows={3}
              maxLength={APPROVAL_REASON_MAX}
              disabled={busy}
              placeholder={t(
                'library.models.modelApprovalPanel.whatChangedAndWhyIt',
              )}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-label font-medium text-fg">
              {t('library.models.modelApprovalPanel.approverRoles')}
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
                  {role === 'reviewer'
                    ? t('library.models.modelApprovalPanel.reviewerQa')
                    : role}
                </label>
              ))}
            </div>
            {roles.length === 0 ? (
              <span className="text-danger-text">
                {t('library.models.modelApprovalPanel.nameAtLeastOneApprover')}
              </span>
            ) : null}
          </fieldset>
          <label className="flex cursor-pointer items-center gap-2 text-label text-fg">
            <input
              type="checkbox"
              checked={independent}
              disabled={busy || requireIndependence}
              onChange={(event) => setIndependent(event.target.checked)}
            />
            {t(
              'library.models.modelApprovalPanel.requireAnIndependentApproverThe',
            )}
          </label>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
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
            {busy
              ? t('library.models.modelApprovalPanel.submitting')
              : t('library.models.modelApprovalPanel.submitForApproval')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ReasonDialog({
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
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!valid || busy}
            onClick={() => onConfirm(trimmed)}
          >
            {busy
              ? t('library.models.modelApprovalPanel.working')
              : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
