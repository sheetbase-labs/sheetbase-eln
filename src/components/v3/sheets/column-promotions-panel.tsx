import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Banner } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { ObjectLink } from '#/components/v3/ui/object-link'
import { Status } from '#/components/v3/ui/status'
import { toast } from '#/components/v3/ui/sonner'
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
  approveApprovalRequest,
  returnApprovalRequest,
  withdrawApprovalRequest,
} from '#/lib/approval-requests'
import type { ApprovalRequest } from '#/lib/approval-requests'
import { objectPath } from '#/lib/navigation'
import { notebookDataClient, formatNotebookDateTime } from '#/lib/notebook-data'
import { DataClientError } from '#/lib/data-client'
import {
  applyColumnPromotion,
  describeColumnPromotionError,
  listOpenColumnPromotions,
} from '#/lib/schema-evolution'
import type { ColumnPromotion } from '#/lib/schema-evolution'
import { useUserNames } from '#/lib/user-names'

export const COLUMN_PROMOTION_KIND = 'column_promotion'

export const columnPromotionsKey = (instanceId?: string) =>
  ['ui-port', 'column-promotions', instanceId ?? 'workspace'] as const

type Dialog = {
  kind: 'approve' | 'return' | 'withdraw'
  promotion: ColumnPromotion
}

/**
 * What a promotion needs next, from the person looking at it. The server
 * decides every one of these again; this only picks the button to show.
 */
export type PromotionNextStep =
  'decide' | 'waiting' | 'apply' | 'settle' | 'none'

export function promotionNextStep(
  request: ApprovalRequest | null,
  userId: string | null | undefined,
  role: string | null | undefined,
  requestedBy: string,
): PromotionNextStep {
  if (!request) return 'none'
  if (request.state === 'pending') {
    return canDecide(request, userId, role) ? 'decide' : 'waiting'
  }
  if (!isWorkspaceWriter(role)) return 'none'
  if (request.state === 'approved') {
    return userId === requestedBy || role === 'steward' || role === 'admin'
      ? 'apply'
      : 'none'
  }
  // Returned or withdrawn: recording the outcome frees the column again.
  return 'settle'
}

/**
 * Column promotions waiting on a steward or on being applied. Approving does
 * not write anything; applying does, and lands on the dataset it wrote.
 */
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
            : 'Please try again.',
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
      toast('Promotion approved', {
        description:
          'Nothing has moved yet. The person who asked, or a steward, applies it.',
      })
    },
    onError: failed('Could not approve'),
  })
  const returnBack = useMutation({
    mutationFn: (input: { requestId: string; reason: string }) =>
      returnApprovalRequest(client, input.requestId, input.reason),
    onSuccess: () => {
      setDialog(null)
      refresh()
      toast('Promotion returned', {
        description: 'The column stays local to the sheet.',
      })
    },
    onError: failed('Could not return the promotion'),
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
      toast('Promotion withdrawn')
    },
    onError: failed('Could not withdraw the promotion'),
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
        toast('Column promoted', {
          description: 'The values now live in the dataset.',
        })
        const to = objectPath('dataset', result.datasetId)
        if (to) void navigate({ to } as never)
        return
      }
      toast('Promotion closed', {
        description: result.reason
          ? `Reason on record: ${result.reason}`
          : 'The column stays local to the sheet.',
      })
    },
    onError: failed('Could not apply the promotion'),
  })
  const busy =
    approve.isPending ||
    returnBack.isPending ||
    withdraw.isPending ||
    apply.isPending

  if (promotions.isLoading) return null
  if (promotions.isError) {
    return (
      <Banner tone="bad" title="Could not load column promotions">
        Reload the page, or ask an admin if it keeps happening.
      </Banner>
    )
  }
  if (rows.length === 0) {
    return instanceId ? null : (
      <EmptyState
        title="No promotions are waiting"
        description="When someone asks to move a sheet column into a dataset, it appears here for a steward to decide."
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
        const step = promotionNextStep(
          request,
          user?.id,
          role,
          promotion.requested_by_user_id,
        )
        const stewardRoles = request?.required_approver_roles ?? ['steward']
        return (
          <div
            key={promotion.id}
            className="flex flex-wrap items-center gap-3 rounded-md border p-3"
          >
            <div className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-body">
                Promote a column of{' '}
                <ObjectLink
                  kind="sheet"
                  id={promotion.sheet_instance_id}
                  mono={false}
                >
                  its sheet
                </ObjectLink>{' '}
                into{' '}
                {promotion.target === 'model_field'
                  ? `the ${promotion.model_key ?? 'record'} model`
                  : 'a dataset'}
              </span>
              <span className="text-caption text-fg-muted">
                {promotion.reason ?? 'No reason given'} ·{' '}
                {names.userLabel(promotion.requested_by_user_id)} ·{' '}
                {formatNotebookDateTime(promotion.requested_at)}
              </span>
              {step === 'waiting' ? (
                <span className="text-caption text-fg-muted">
                  Waiting for {stewardRoles.map(roleLabel).join(' or ')}. The
                  person who asked cannot approve their own request.
                </span>
              ) : null}
              {request && request.state !== 'pending' ? (
                <span className="text-caption text-fg-muted">
                  {request.state === 'approved'
                    ? 'Approved. Apply it to write the dataset.'
                    : `${request.state === 'returned' ? 'Returned' : 'Withdrawn'}${
                        request.decision_reason
                          ? `: ${request.decision_reason}`
                          : ''
                      }`}
                </span>
              ) : null}
            </div>
            <Status
              tone={
                request?.state === 'approved'
                  ? 'ok'
                  : request?.state === 'pending'
                    ? 'review'
                    : 'stored'
              }
            >
              {request?.state === 'approved'
                ? 'Approved'
                : request?.state === 'pending'
                  ? 'Awaiting approval'
                  : (request?.state ?? 'Unknown')}
            </Status>
            <span className="flex flex-wrap gap-2">
              {step === 'decide' ? (
                <>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => setDialog({ kind: 'return', promotion })}
                  >
                    Return
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy}
                    onClick={() => setDialog({ kind: 'approve', promotion })}
                  >
                    Approve
                  </Button>
                </>
              ) : null}
              {request &&
              request.state === 'pending' &&
              canWithdraw(request, user?.id, role) ? (
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={busy}
                  onClick={() => setDialog({ kind: 'withdraw', promotion })}
                >
                  Withdraw
                </Button>
              ) : null}
              {step === 'apply' ? (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  onClick={() => apply.mutate(promotion)}
                >
                  Apply promotion
                </Button>
              ) : null}
              {step === 'settle' ? (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => apply.mutate(promotion)}
                >
                  Keep the column local
                </Button>
              ) : null}
            </span>
          </div>
        )
      })}
      <ReasonDialog
        open={dialog?.kind === 'approve'}
        busy={busy}
        title="Approve this promotion"
        description="Approving does not move any data. Applying the promotion afterwards writes the dataset."
        label="Note (optional)"
        required={false}
        confirmLabel="Approve"
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
        title="Return this promotion"
        description="The column stays local. The person who asked sees your reason."
        label="Reason for returning"
        required
        confirmLabel="Return"
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
        title="Withdraw this promotion"
        description="The request stops waiting and the column stays local."
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
    </div>
  )
}
