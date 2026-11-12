import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'

import { t } from '#/copy'
import { ProjectListFailure } from '#/components/projects/project-list'
import { Muted } from '#/components/ui/layout'
import { usePublishApproval } from '#/components/pipelines/activity/use-publish-approval'
import {
  usePipelineVersions,
  useSchedules,
} from '#/components/pipelines/pipelines-data'
import { StartsPage } from '#/components/pipelines/starts/starts-page'
import { useStartRules } from '#/components/pipelines/starts/starts-data'

/** The Starts and runs tab: how a run begins, what has to be true first, what
 * the starts heard and did, and the week of runs that followed. */
export const Route = createFileRoute('/pipelines/$pipelineId/starts')({
  component: PipelineStarts,
})

function PipelineStarts() {
  const { pipelineId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const schedules = useSchedules(pipelineId)
  const rules = useStartRules(pipelineId)
  const versions = usePipelineVersions(pipelineId)
  const list = useMemo(() => versions.data ?? [], [versions.data])

  const approval = usePublishApproval(list, {
    workspaceId,
    role: context.workspace?.role,
    userId: context.user.id,
  })

  const failed = schedules.isError ? schedules : rules.isError ? rules : null

  if (failed) {
    return (
      <div className="px-4 py-4 md:px-6">
        <ProjectListFailure
          error={failed.error}
          what={t('features.pipelineStarts.tab.failure')}
          onRetry={() => void failed.refetch()}
        />
      </div>
    )
  }

  if (!schedules.data || !rules.data) {
    return (
      <div className="px-4 py-4 md:px-6">
        <Muted>{t('features.pipelineStarts.tab.loading')}</Muted>
      </div>
    )
  }

  return (
    <StartsPage
      // A saved change resets the form to what the database holds.
      key={JSON.stringify(rules.data)}
      pipelineId={pipelineId}
      workspaceId={workspaceId}
      schedules={schedules.data}
      rules={rules.data}
      publishWaiting={Boolean(approval.pending)}
    />
  )
}
