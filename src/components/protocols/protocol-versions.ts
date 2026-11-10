/**
 * The protocol versions panel's own vocabulary: where its list is cached, what
 * one version's approval says, and the dialog the panel can be showing. Apart
 * from the panel so that file holds only the component.
 */
import type { ProtocolVersion } from '#/lib/controlled-protocols'
import type { ApprovalRequest } from '#/lib/approval-requests'
import type { ApprovalDecision } from '#/components/models/model-approval'

export const protocolVersionsKey = (protocolRecordId: string) =>
  ['ui-port', 'protocol-versions', protocolRecordId] as const

export type RowDialog =
  | { kind: 'approve' | 'return' | 'withdraw'; version: ProtocolVersion }
  | { kind: 'submit'; resume?: ProtocolVersion }

/** Everything the panel knows about one version's approval chain. */
export interface ApprovalFor {
  requests: ApprovalRequest[]
  decisions: ApprovalDecision[]
  pending: ApprovalRequest | null
  latest: ApprovalRequest | null
}
