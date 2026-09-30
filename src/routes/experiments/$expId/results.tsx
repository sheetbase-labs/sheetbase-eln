import { createFileRoute } from '@tanstack/react-router'

import { CapabilityGap } from '#/components/v3/ui/capability-gap'
import { capabilityRoadmap, useCapabilities } from '#/lib/capabilities'

/**
 * UI port: the experiment Results tab. Curated results (figures, tables and
 * the decision) are their own capability and not built, so this shows the
 * honest CapabilityGap pattern (`?state=gap` forces it for the suite).
 */
export const Route = createFileRoute('/experiments/$expId/results')({
  validateSearch: (search: Record<string, unknown>) => ({
    state: typeof search.state === 'string' ? search.state : undefined,
  }),
  component: ResultsTab,
})

function ResultsTab() {
  const capabilities = useCapabilities()
  const { expId } = Route.useParams()
  const { state } = Route.useSearch()
  const { context } = Route.useRouteContext()
  const role = context.workspace?.role
  const admin = role === 'owner' || role === 'admin'

  if (capabilities.experimentResults && state !== 'gap') {
    // The curated-results view arrives with the capability.
    return null
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <CapabilityGap
        title="Curated results aren’t built in this workspace yet"
        will="The figures, tables and the decision that summarise an experiment — the ones a reviewer reads first — will be gathered here from the analyses and datasets it produced."
        roadmap={capabilityRoadmap.experimentResults}
        admin={admin}
        instead={[
          {
            label: 'The experiment notebook',
            link: {
              to: '/experiments/$expId/notebook',
              params: { expId },
            },
            note: 'The record, with its analyses embedded.',
          },
          {
            label: 'Datasets this experiment produced',
            link: {
              to: '/experiments/$expId/datasets',
              params: { expId },
            },
            note: 'Where the measured values live today.',
          },
        ]}
      />
    </div>
  )
}
