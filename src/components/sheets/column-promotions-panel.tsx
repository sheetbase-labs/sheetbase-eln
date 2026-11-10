import { rich, t } from '#/copy'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Banner } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { ObjectLink } from '#/components/ui/object-link'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import { useModelApprovalIndex } from '#/components/models/model-approval-data'
import { ReasonDialog } from '#/components/models/model-approval-panel'
import {
  canWithdraw,
  latestRequest,
  pendingRequest,
  roleLabel,
} from '#/components/models/model-approval'
import {
  approveApprovalRequest,
  returnApprovalRequest,
  withdrawApprovalRequest,
} from '#/lib/approval-requests'
import type { ApprovalRequest } from '#/lib/approval-requests'
import { notebookDataClient, formatNotebookDateTime } from '#/lib/notebook-data'
import { DataClientError } from '#/lib/data-client'
import {
  applyColumnPromotion,
  describeColumnPromotionError,
  listOpenColumnPromotions,
} from '#/lib/schema-evolution'
import type { ColumnPromotion } from '#/lib/schema-evolution'
import { useUserNames } from '#/lib/user-names'
import {
  COLUMN_PROMOTION_KIND,
  columnPromotionsKey,
  promotionNextStep,
} from './column-promotions'
import type { PromotionNextStep } from './column-promotions'

export {
  COLUMN_PROMOTION_KIND,
  columnPromotionsKey,
  promotionNextStep,
} from './column-promotions'

export type { PromotionNextStep } from './column-promotions'

type Dialog = {
  kind: 'approve' | 'return' | 'withdraw'
  promotion: ColumnPromotion
}

/**
 * Column promotions waiting on a steward or on being applied. Approving does
 * not write anything; applying does, and lands on the dataset it wrote.
 */
function declinedLabel(state: string): string {
  return state === 'returned'
    ? t('notebook.columnPromotionsPanel.returned')
    : t('notebook.columnPromotionsPanel.withdrawn')
}

/** How one approval state is painted and named. */
interface ApprovalBand {
  tone: Tone
  label: string
}

/** The band a promotion's approval shows: its tone and its word. */
function requestBand(request: ApprovalRequest | null): ApprovalBand {
  if (request?.state === 'approved')
    return { tone: 'ok', label: t('notebook.columnPromotionsPanel.approved') }

  if (request?.state === 'pending')
    return {
      tone: 'review',
      label: t('notebook.columnPromotionsPanel.awaitingApproval'),
    }

  return {
    tone: 'stored',
    label: request?.state ?? t('notebook.columnPromotionsPanel.unknown'),
  }
}

/** What the last decision says, when the request is no longer waiting. */
function decisionLine(request: ApprovalRequest | null): string | null {
  if (!request || request.state === 'pending') return null

  if (request.state === 'approved')
    return t('notebook.columnPromotionsPanel.approvedApplyItTo')

  if (request.decision_reason)
    return t('notebook.columnPromotionsPanel.declinedWithReason', {
      outcome: declinedLabel(request.state),
      reason: request.decision_reason,
    })

  return declinedLabel(request.state)
}

/** One promotion: what it asks for, where it stands, and what it needs next. */
function PromotionRow({
  promotion,
  request,
  step,
  busy,
  names,
  userId,
  role,
  onDialog,
  onApply,
}: {
  promotion: ColumnPromotion
  request: ApprovalRequest | null
  step: PromotionNextStep
  busy: boolean
  names: ReturnType<typeof useUserNames>
  userId: string | undefined
  role: string | null | undefined
  onDialog: (dialog: Dialog) => void
  onApply: (promotion: ColumnPromotion) => void
}) {
  const stewardRoles = request?.required_approver_roles ?? ['steward']
  const band = requestBand(request)
  const decision = decisionLine(request)

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-body">
          {rich(
            promotion.target === 'model_field'
              ? 'notebook.columnPromotionsPanel.promoteToModel'
              : 'notebook.columnPromotionsPanel.promoteToDataset',
            {
              sheet: (
                <ObjectLink
                  kind="sheet"
                  id={promotion.sheet_instance_id}
                  mono={false}
                >
                  {t('notebook.columnPromotionsPanel.itsSheet')}
                </ObjectLink>
              ),
              model:
                promotion.model_key ??
                t('notebook.columnPromotionsPanel.recordFallback'),
            },
          )}
        </span>
        <span className="text-caption text-fg-muted">
          {promotion.reason ??
            t('notebook.columnPromotionsPanel.noReasonGiven')}{' '}
          · {names.userLabel(promotion.requested_by_user_id)} ·{' '}
          {formatNotebookDateTime(promotion.requested_at)}
        </span>
        {step === 'waiting' ? (
          <span className="text-caption text-fg-muted">
            {t('notebook.columnPromotionsPanel.waitingForStewardrolesThe', {
              stewardRoles: stewardRoles.map(roleLabel).join(' or '),
            })}
          </span>
        ) : null}
        {decision ? (
          <span className="text-caption text-fg-muted">{decision}</span>
        ) : null}
      </div>
      <Status tone={band.tone}>{band.label}</Status>
      <span className="flex flex-wrap gap-2">
        {step === 'decide' ? (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onDialog({ kind: 'return', promotion })}
            >
              {t('notebook.columnPromotionsPanel.return')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => onDialog({ kind: 'approve', promotion })}
            >
              {t('notebook.columnPromotionsPanel.approve')}
            </Button>
          </>
        ) : null}
        {request &&
        request.state === 'pending' &&
        canWithdraw(request, userId, role) ? (
          <Button
            size="sm"
            variant="quiet"
            disabled={busy}
            onClick={() => onDialog({ kind: 'withdraw', promotion })}
          >
            {t('notebook.columnPromotionsPanel.withdraw')}
          </Button>
        ) : null}
        {step === 'apply' ? (
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => onApply(promotion)}
          >
            {t('notebook.columnPromotionsPanel.applyPromotion')}
          </Button>
        ) : null}
        {step === 'settle' ? (
          <Button size="sm" disabled={busy} onClick={() => onApply(promotion)}>
            {t('notebook.columnPromotionsPanel.keepTheColumnLocal')}
          </Button>
        ) : null}
      </span>
    </div>
  )
}

export function ColumnPromotionsPanel({
  instanceId,
  role,
  user,
  client = notebookDataClient,
}: {
  /** Limit to one sheet; omitted, every open promotion in the workspace. */
  instanceId?: string
  role: string | null | undefined
  user: { id: string; name: string } | null
  client?: typeof notebookDataClient
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<Dialog | null>(null)

  const promotions = useQuery({
    queryKey: columnPromotionsKey(instanceId),
    queryFn: () => listOpenColumnPromotions(client, instanceId),
  })

  const rows = promotions.data ?? []

  const approvals = useModelApprovalIndex(
    rows.map((row) => row.id),
    client,
    COLUMN_PROMOTION_KIND,
  )

  const names = useUserNames(
    rows.map((row) => row.requested_by_user_id),
    user ?? undefined,
  )

  function refresh() {
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'column-promotions'],
    })
    void queryClient.invalidateQueries({ queryKey: ['column-promotions'] })
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'models', 'approval-index'],
    })
    void queryClient.invalidateQueries({ queryKey: ['work-items'] })
  }

  const failed = (title: string) => (cause: unknown) =>
    toast(title, {
      description:
        cause instanceof DataClientError
          ? describeColumnPromotionError(cause)
          : cause instanceof Error
            ? cause.message
            : t('notebook.columnPromotionsPanel.description'),
    })

  const approve = useMutation({
    mutationFn: (input: { requestId: string; reason: string }) =>
      approveApprovalRequest(
        client,
        input.requestId,
        input.reason || undefined,
      ),
    onSuccess: () => {
      setDialog(null)
      refresh()
      toast(t('notebook.columnPromotionsPanel.promotionApproved'), {
        description: t(
          'notebook.columnPromotionsPanel.nothingHasMovedYetDescription',
        ),
      })
    },
    onError: failed(t('notebook.columnPromotionsPanel.couldNotApprove')),
  })

  const returnBack = useMutation({
    mutationFn: (input: { requestId: string; reason: string }) =>
      returnApprovalRequest(client, input.requestId, input.reason),
    onSuccess: () => {
      setDialog(null)
      refresh()
      toast(t('notebook.columnPromotionsPanel.promotionReturned'), {
        description: t(
          'notebook.columnPromotionsPanel.theColumnStaysLocalDescription',
        ),
      })
    },
    onError: failed(t('notebook.columnPromotionsPanel.couldNotReturnThe')),
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
      toast(t('notebook.columnPromotionsPanel.promotionWithdrawn'))
    },
    onError: failed(t('notebook.columnPromotionsPanel.couldNotWithdrawThe')),
  })

  const apply = useMutation({
    mutationFn: (promotion: ColumnPromotion) =>
      applyColumnPromotion(client, promotion.id),
    onSuccess: (result, promotion) => {
      refresh()
      void queryClient.invalidateQueries({
        queryKey: ['sheet-instance', promotion.sheet_instance_id],
      })
      void queryClient.invalidateQueries({
        queryKey: ['composed-sheet', promotion.sheet_instance_id],
      })

      if (result.applied && result.datasetId) {
        toast(t('notebook.columnPromotionsPanel.columnPromoted'), {
          description: t(
            'notebook.columnPromotionsPanel.theValuesNowLiveDescription',
          ),
        })
        // Applying lands on the dataset the column was promoted into.
        void navigate({
          to: '/datasets/$datasetId',
          params: { datasetId: result.datasetId },
        })

        return
      }

      toast(t('notebook.columnPromotionsPanel.promotionClosed'), {
        description: result.reason
          ? t(
              'notebook.columnPromotionsPanel.reasonOnRecordReasonDescription',
              { reason: result.reason },
            )
          : t('notebook.columnPromotionsPanel.theColumnStaysLocalDescription'),
      })
    },
    onError: failed(t('notebook.columnPromotionsPanel.couldNotApplyThe')),
  })

  const busy =
    approve.isPending ||
    returnBack.isPending ||
    withdraw.isPending ||
    apply.isPending

  if (promotions.isLoading) return null

  if (promotions.isError) {
    return (
      <Banner tone="bad" title={t('notebook.columnPromotionsPanel.title')}>
        {t('notebook.columnPromotionsPanel.reloadThePageOr')}
      </Banner>
    )
  }

  if (rows.length === 0) {
    return instanceId ? null : (
      <EmptyState
        title={t('notebook.columnPromotionsPanel.noPromotionsAreWaitingTitle')}
        description={t(
          'notebook.columnPromotionsPanel.whenSomeoneAsksToDescription',
        )}
      />
    )
  }

  const dialogRequest = dialog
    ? pendingRequest(approvals.data?.byVersion.get(dialog.promotion.id) ?? [])
    : null

  return (
    <div className="grid gap-2" data-testid="column-promotions">
      {rows.map((promotion) => {
        const request = latestRequest(
          approvals.data?.byVersion.get(promotion.id) ?? [],
        )

        return (
          <PromotionRow
            key={promotion.id}
            promotion={promotion}
            request={request}
            step={promotionNextStep(
              request,
              user?.id,
              role,
              promotion.requested_by_user_id,
            )}
            busy={busy}
            names={names}
            userId={user?.id}
            role={role}
            onDialog={setDialog}
            onApply={(next) => apply.mutate(next)}
          />
        )
      })}
      <ReasonDialog
        open={dialog?.kind === 'approve'}
        busy={busy}
        title={t('notebook.columnPromotionsPanel.approveThisPromotionTitle')}
        description={t(
          'notebook.columnPromotionsPanel.approvingDoesNotMoveDescription',
        )}
        label={t('notebook.columnPromotionsPanel.label')}
        required={false}
        confirmLabel={t('notebook.columnPromotionsPanel.approve')}
        onOpenChange={(open) => !open && setDialog(null)}
        onConfirm={(reason) =>
          dialogRequest
            ? approve.mutate({ requestId: dialogRequest.id, reason })
            : undefined
        }
      />
      <ReasonDialog
        open={dialog?.kind === 'return'}
        busy={busy}
        title={t('notebook.columnPromotionsPanel.returnThisPromotionTitle')}
        description={t(
          'notebook.columnPromotionsPanel.theColumnStaysLocalDescription2',
        )}
        label={t('notebook.columnPromotionsPanel.reasonForReturningLabel')}
        required
        confirmLabel={t('notebook.columnPromotionsPanel.return')}
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
        title={t('notebook.columnPromotionsPanel.withdrawThisPromotionTitle')}
        description={t(
          'notebook.columnPromotionsPanel.theRequestStopsWaitingDescription',
        )}
        label={t('notebook.columnPromotionsPanel.reasonOptionalLabel')}
        required={false}
        confirmLabel={t('notebook.columnPromotionsPanel.withdraw')}
        onOpenChange={(open) => !open && setDialog(null)}
        onConfirm={(reason) =>
          dialogRequest
            ? withdraw.mutate({ requestId: dialogRequest.id, reason })
            : undefined
        }
      />
    </div>
  )
}
