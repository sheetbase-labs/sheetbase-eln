import { createFileRoute, Navigate } from '@tanstack/react-router'

import { t } from '#/copy'
import { usePipelineIdForRun } from '#/components/v3/pipelines/pipelines-data'
import { Notice } from '#/components/v3/ui/alert'
import { PageHeader } from '#/components/v3/ui/layout'

/** UI port (roadmap-4/ui-app3): run records moved under their pipeline. Links
 * made before that move (notebook output blocks, admin lists) land here and are
 * sent on to /pipelines/$pipelineId/runs/$runId. A run that cannot be resolved
 * (unknown id, deleted run, query failure) says so and offers the way back
 * instead of rendering a blank page. */
export const Route = createFileRoute('/pipelines/runs/$runId')({
  component: RunRedirect,
})

function RunRedirect() {
  const { runId } = Route.useParams()
  const pipelineId = usePipelineIdForRun(runId)
  if (pipelineId.data) {
    return (
      <Navigate
        to="/pipelines/$pipelineId/runs/$runId"
        params={{ runId, pipelineId: pipelineId.data }}
        replace
      />
    )
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          {
            label: t('data.pipelineRunRedirect.pipelines'),
            link: { to: '/pipelines' },
          },
        ]}
        title={
          pipelineId.isLoading
            ? t('data.pipelineRunRedirect.loadingRun')
            : pipelineId.isError
              ? t('data.pipelineRunRedirect.runUnavailable')
              : t('data.pipelineRunRedirect.runFound')
        }
      />
      {pipelineId.isError ? (
        <div className="px-4 py-4 md:px-6">
          <Notice
            tone="bad"
            title={t('data.pipelineRunRedirect.couldResolveRun')}
          >
            {pipelineId.error instanceof Error
              ? pipelineId.error.message
              : t('data.pipelineRunRedirect.pipelineRunCouldRead')}
          </Notice>
        </div>
      ) : null}
    </div>
  )
}
