import { useQuery } from '@tanstack/react-query'

import { DATASET_SCHEMA_VERSION_KIND } from '#/lib/approval-requests'
import type { ApprovalRequest } from '#/lib/approval-requests'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import type { ApprovalDecision } from './model-approval'
import { listByIds } from '#/lib/chunk-ids'

/**
 * MDL-03.3 — the client read side of the approval store.
 *
 * Reads only: `api.approval_requests` and its decisions under the caller's
 * RLS. Mutations stay with the RPC wrappers in `src/lib/approval-requests.ts`,
 * so the browser cannot write the workflow tables directly.
 */

const DECISION_SELECT =
  'id,request_id,workspace_id,user_id,role,decision,reason,created_at'

export interface ModelApprovalIndex {
  requests: ApprovalRequest[]
  decisions: ApprovalDecision[]
  /** Requests per `object_id` (version), newest first. */
  byVersion: Map<string, ApprovalRequest[]>
  /** Decisions per `request_id`, oldest first. */
  byRequest: Map<string, ApprovalDecision[]>
}

export const modelApprovalQueryKeys = {
  index: (
    versionIds: readonly string[],
    objectKind = DATASET_SCHEMA_VERSION_KIND,
  ) =>
    [
      'ui-port',
      'models',
      'approval-index',
      objectKind,
      versionIds.join(','),
    ] as const,
}

function buildIndex(
  requests: ApprovalRequest[],
  decisions: ApprovalDecision[],
): ModelApprovalIndex {
  const byVersion = new Map<string, ApprovalRequest[]>()
  for (const request of requests) {
    const list = byVersion.get(request.object_id) ?? []
    list.push(request)
    byVersion.set(request.object_id, list)
  }
  const byRequest = new Map<string, ApprovalDecision[]>()
  for (const decision of decisions) {
    const list = byRequest.get(decision.request_id) ?? []
    list.push(decision)
    byRequest.set(decision.request_id, list)
  }
  return { requests, decisions, byVersion, byRequest }
}

/**
 * Read the approval requests (and their decisions) for a set of dataset schema
 * version ids in one round trip. Every version of a model is fetched together
 * so the Versions tab can show an approval state per row and the full trail for
 * the draft without a query per row.
 */
export function useModelApprovalIndex(
  versionIds: readonly string[],
  client: DataClient = notebookDataClient,
  objectKind = DATASET_SCHEMA_VERSION_KIND,
) {
  const ids = [...new Set(versionIds.filter(Boolean))]
  return useQuery({
    queryKey: modelApprovalQueryKeys.index(ids, objectKind),
    queryFn: async (): Promise<ModelApprovalIndex> => {
      if (ids.length === 0) return buildIndex([], [])
      const requests = (
        await listByIds(ids, (inList) =>
          client.list<ApprovalRequest>(
            'approval_requests',
            `?object_kind=eq.${encodeURIComponent(objectKind)}` +
              `&object_id=in.(${inList})` +
              '&select=id,workspace_id,object_kind,object_id,object_revision,' +
              'required_approver_roles,required_approvals,require_independence,state,' +
              'reason,decision_reason,approved_by_user_ids,submitted_by_user_id,' +
              'submitted_at,decided_by_user_id,decided_at,created_at,updated_at' +
              '&order=created_at.desc',
          ),
        )
      ).sort((a, b) => b.created_at.localeCompare(a.created_at))
      const requestIds = requests.map((request) => request.id)
      const decisions = requestIds.length
        ? (
            await listByIds(requestIds, (inList) =>
              client.list<ApprovalDecision>(
                'approval_request_decisions',
                `?request_id=in.(${inList})` +
                  `&select=${DECISION_SELECT}&order=created_at.asc`,
              ),
            )
          ).sort((a, b) => a.created_at.localeCompare(b.created_at))
        : []
      return buildIndex(requests, decisions)
    },
    enabled: ids.length > 0,
    staleTime: 15_000,
  })
}
