import { createFileRoute } from '@tanstack/react-router'

import { CapabilityGap } from '#/components/v3/ui/capability-gap'
import { capabilityRoadmap } from '#/lib/capabilities'

/**
 * UI port (roadmap-4/ui-app3): the pipeline Steps editor. Editing steps in
 * Sheetbase is not built, so this shows the honest gap with the real
 * alternatives; `?state=gap` forces it for the acceptance suite.
 */
export const Route = createFileRoute('/pipelines/$pipelineId/steps')({
  validateSearch: (search: Record<string, unknown>): { state?: 'gap' } => ({
    state: search.state === 'gap' ? 'gap' : undefined,
  }),
  component: PipelineSteps,
})

function PipelineSteps() {
  const { pipelineId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const role = context.workspace?.role
  const admin = role === 'owner' || role === 'admin'
  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <CapabilityGap
        title="Steps can’t be edited in Sheetbase yet"
        will="You will be able to add, reorder and configure steps here, then publish a new pipeline version for approval."
        roadmap={capabilityRoadmap.pipelineSteps}
        admin={admin}
        instead={[
          {
            label: 'Pipeline runs',
            link: {
              to: '/pipelines/$pipelineId/runs',
              params: { pipelineId },
            },
            note: 'Inputs, outputs and logs for every run.',
          },
          {
            label: 'Pipelines',
            link: { to: '/pipelines' },
            note: 'Steps are changed in the pipeline’s code repository.',
          },
        ]}
      />
    </div>
  )
}
