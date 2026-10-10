import { createFileRoute, Navigate } from '@tanstack/react-router'

import { usePipelineIdForRun } from '#/components/v3/pipelines/pipelines-data'

/** UI port (roadmap-4/ui-app3): run records moved under their pipeline. Links
 * made before that move (notebook output blocks, admin lists) land here and are
 * sent on to /pipelines/$pipelineId/runs/$runId. */
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
  return null
}
