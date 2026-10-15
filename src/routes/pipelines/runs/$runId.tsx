import { Link, createFileRoute, Navigate } from '@tanstack/react-router'

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
        crumbs={
          <Link to="/pipelines" className="text-link">
            Pipelines
          </Link>
        }
        title={
          pipelineId.isLoading
            ? 'Loading run…'
            : pipelineId.isError
              ? 'Run unavailable'
              : 'Run not found'
        }
      />
      {pipelineId.isError ? (
        <div className="px-4 py-4 md:px-6">
          <Notice tone="bad" title="Could not resolve this run.">
            {pipelineId.error instanceof Error
              ? pipelineId.error.message
              : 'The pipeline for this run could not be read.'}
          </Notice>
        </div>
      ) : null}
    </div>
  )
}
