import { createFileRoute } from '@tanstack/react-router'

import { CapabilityGap } from '#/components/v3/ui/capability-gap'
import { capabilityRoadmap, useCapabilities } from '#/lib/capabilities'

/**
 * UI port: the sample Measurements tab. Measurement storage is owned by the
 * results capability, which is not built, so this shows the honest
 * CapabilityGap pattern (`?state=gap` forces it for the acceptance suite).
 */
export const Route = createFileRoute('/samples/$sampleId/measurements')({
  validateSearch: (search: Record<string, unknown>) => ({
    state: typeof search.state === 'string' ? search.state : undefined,
  }),
  component: MeasurementsTab,
})

function MeasurementsTab() {
  const capabilities = useCapabilities()
  const { sampleId } = Route.useParams()
  const { state } = Route.useSearch()
  const { context } = Route.useRouteContext()
  const role = context.workspace?.role
  const admin = role === 'owner' || role === 'admin'

  if (capabilities.sampleMeasurements && state !== 'gap') {
    // The real table arrives with the capability; until then the gap is the
    // only honest state. This branch is the seam the capability plugs into.
    return null
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <CapabilityGap
        title="Measurements aren’t recorded on samples in this workspace yet"
        will="Assay results measured against a sample — the value, unit, method, who ran it and when — will be recorded here and can be cited in records."
        roadmap={capabilityRoadmap.sampleMeasurements}
        admin={admin}
        instead={[
          {
            label: 'Datasets that include this sample',
            link: { to: '/datasets' },
            note: 'Where measured values live today.',
          },
          {
            label: 'Sample history',
            link: {
              to: '/samples/$sampleId/history',
              params: { sampleId },
            },
            note: 'What has happened to this sample.',
          },
        ]}
      />
    </div>
  )
}
