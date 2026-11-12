import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import {
  PIPELINE_DEFINITION_VERSION_KIND,
  approveApprovalRequest,
  requestPipelinePublish,
  returnApprovalRequest,
  withdrawApprovalRequest,
} from '#/lib/approval-requests'
import { notebookDataClient } from '#/lib/notebook-data'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'
import { toast } from '#/components/ui/sonner'
import { useModelApprovalIndex } from '#/components/models/model-approval-data'
import {
  canDecide,
  canWithdraw,
  latestRequest,
  pendingRequest,
} from '#/components/models/model-approval'

export interface PublishApprovalActor {
  workspaceId: string
  role: string | null | undefined
  userId: string | null | undefined
}

/**
 * One pipeline's publish requests, read under the person's own access, and
 * the four things they can do with one. Asking is any pipeline maker's;
 * deciding is an owner's or admin's; withdrawing is the asker's. The database
 * re-checks all of it (`request_pipeline_publish`, `approve_approval_request`).
 */
export function usePublishApproval(
  versions: readonly PipelineDefinitionVersionWire[],
  actor: PublishApprovalActor,
  /** When the page edits the draft: saves what is on screen and returns the draft's id. */
  prepare?: () => Promise<string>,
) {
  const queryClient = useQueryClient()
  const ids = useMemo(() => versions.map((version) => version.id), [versions])

  const index = useModelApprovalIndex(
    ids,
    notebookDataClient,
    PIPELINE_DEFINITION_VERSION_KIND,
  )

  const requests = useMemo(() => index.data?.requests ?? [], [index.data])
  const decisions = useMemo(() => index.data?.decisions ?? [], [index.data])
  const pending = pendingRequest(requests)

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['ui-port', 'pipelines'] })

    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'models', 'approval-index'],
    })
  }

  const fail = (cause: unknown) =>
    toast(t('features.pipelineApprovals.activity.couldNot'), {
      description:
        cause instanceof Error
          ? cause.message
          : t('features.pipelineApprovals.publish.tryAgain'),
    })

  const ask = useMutation({
    mutationFn: async (input: { versionId?: string; reason: string }) => {
      const versionId = prepare ? await prepare() : input.versionId

      if (!versionId)
        throw new Error(t('features.pipelineApprovals.publish.tryAgain'))

      return requestPipelinePublish(notebookDataClient, {
        workspaceId: actor.workspaceId,
        versionId,
        reason: input.reason,
      })
    },
    onSuccess: () => {
      invalidate()

      toast(t('features.pipelineApprovals.publish.asked'), {
        description: t('features.pipelineApprovals.publish.askedBody'),
      })
    },
    onError: (cause) =>
      toast(t('features.pipelineApprovals.publish.couldNotAsk'), {
        description:
          cause instanceof Error
            ? cause.message
            : t('features.pipelineApprovals.publish.tryAgain'),
      }),
  })

  const withdraw = useMutation({
    mutationFn: (reason: string) =>
      withdrawApprovalRequest(
        notebookDataClient,
        pending!.id,
        reason || undefined,
      ),
    onSuccess: () => {
      invalidate()
      toast(t('features.pipelineApprovals.activity.withdrawn'))
    },
    onError: fail,
  })

  const approve = useMutation({
    mutationFn: (reason: string) =>
      approveApprovalRequest(
        notebookDataClient,
        pending!.id,
        reason || undefined,
      ),
    onSuccess: () => {
      invalidate()
      toast(t('features.pipelineApprovals.activity.approved'))
    },
    onError: fail,
  })

  const returnForChanges = useMutation({
    mutationFn: (reason: string) =>
      returnApprovalRequest(notebookDataClient, pending!.id, reason),
    onSuccess: () => {
      invalidate()

      toast(t('features.pipelineApprovals.activity.returned'), {
        description: t('features.pipelineApprovals.activity.returnedToast'),
      })
    },
    onError: fail,
  })

  return {
    requests,
    decisions,
    pending,
    latest: latestRequest(requests),
    loading: index.isLoading,
    canDecide: canDecide(pending, actor.userId, actor.role),
    canWithdraw: canWithdraw(pending, actor.userId, actor.role),
    ask,
    withdraw,
    approve,
    returnForChanges,
    busy:
      ask.isPending ||
      withdraw.isPending ||
      approve.isPending ||
      returnForChanges.isPending,
  }
}

export type PublishApproval = ReturnType<typeof usePublishApproval>
