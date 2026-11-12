import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'

import { t } from '#/copy'
import { EmptyState } from '#/components/ui/empty-state'
import { ProjectListFailure } from '#/components/projects/project-list'
import { Muted } from '#/components/ui/layout'
import { BoardScope } from '#/features/pipelines/board/board'
import { usePipelineVersions } from '#/components/pipelines/pipelines-data'
import { ActivityFeed } from '#/components/pipelines/activity/activity-feed'
import {
  activityActorIds,
  buildActivity,
} from '#/components/pipelines/activity/activity-events'
import { PublishRequestCard } from '#/components/pipelines/activity/publish-request-card'
import { usePublishApproval } from '#/components/pipelines/activity/use-publish-approval'
import { useDisplayTimeZone } from '#/lib/display-time-zone'
import { useUserNames } from '#/lib/user-names'

/**
 * The Activity tab: who changed what, and when. The open publish request sits
 * on top with the text diff an approver reads; below it the history of the
 * pipeline's versions, drafts, requests, approvals and publishing.
 */
export const Route = createFileRoute('/pipelines/$pipelineId/activity')({
  component: PipelineActivity,
})

function PipelineActivity() {
  useDisplayTimeZone()
  const { pipelineId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const versions = usePipelineVersions(pipelineId)
  const list = useMemo(() => versions.data ?? [], [versions.data])

  const approval = usePublishApproval(list, {
    workspaceId: context.workspace?.id ?? '',
    role: context.workspace?.role,
    userId: context.user.id,
  })

  const events = useMemo(
    () => buildActivity(list, approval.requests, approval.decisions),
    [list, approval.requests, approval.decisions],
  )

  const { userLabel } = useUserNames(activityActorIds(events), {
    id: context.user.id,
    name: context.user.name,
  })

  const actorLabel = useCallback(
    (id: string | null | undefined) =>
      id ? userLabel(id) : t('features.pipelineApprovals.activity.someone'),
    [userLabel],
  )

  if (versions.isError)
    return (
      <div className="px-4 py-4 md:px-6">
        <ProjectListFailure
          error={versions.error}
          what="pipeline activity"
          onRetry={() => void versions.refetch()}
        />
      </div>
    )

  return (
    <BoardScope className="flex min-w-0 flex-1 flex-col gap-4 px-4 py-4 md:px-6">
      <Muted>{t('features.pipelineApprovals.activity.lead')}</Muted>
      <PublishRequestCard
        versions={list}
        approval={approval}
        actorLabel={actorLabel}
      />
      {events.length === 0 && !versions.isLoading ? (
        <EmptyState title={t('features.pipelineApprovals.activity.empty')} />
      ) : (
        <ActivityFeed events={events} actorLabel={actorLabel} />
      )}
    </BoardScope>
  )
}
