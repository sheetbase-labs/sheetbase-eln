/**
 * What a column promotion is, where its open ones are cached, and what it needs
 * next. Apart from the panel that draws them, so the screen's file holds only
 * the component.
 */
import type { ApprovalRequest } from '#/lib/approval-requests'

import {
  canDecide,
  isWorkspaceWriter,
} from '#/components/models/model-approval'

export const COLUMN_PROMOTION_KIND = 'column_promotion'

export const columnPromotionsKey = (instanceId?: string) =>
  ['ui-port', 'column-promotions', instanceId ?? 'workspace'] as const

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
