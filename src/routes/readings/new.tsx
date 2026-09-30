import { createFileRoute, redirect } from '@tanstack/react-router'

import { CapabilityGap } from '#/components/v3/ui/capability-gap'
import { PageHeader } from '#/components/v3/ui/layout'
import { capabilityRoadmap, useCapabilities } from '#/lib/capabilities'

/**
 * UI port (roadmap-4/ui-app3): record a reading at the bench. The bench-reading
 * capability (MOB-02) is not built, so this shows the honest gap with the real
 * alternatives; `?state=gap` forces it for the acceptance suite.
 */
export const Route = createFileRoute('/readings/new')({
  validateSearch: (search: Record<string, unknown>): { state?: 'gap' } => ({
    state: search.state === 'gap' ? 'gap' : undefined,
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: NewReading,
})

function NewReading() {
  const capabilities = useCapabilities()
  const { state } = Route.useSearch()
  const { context } = Route.useRouteContext()
  const role = context.workspace?.role
  const admin = role === 'owner' || role === 'admin'

  if (capabilities.benchReading && state !== 'gap') {
    return null
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader crumbs="Readings" title="Record a reading" />
      <div className="px-4 py-5 md:px-6">
        <CapabilityGap
          title="Reading a result into a planned row isn’t built in this workspace yet"
          will="Scan an instrument or sample at the bench, type the value, and have it land in the planned sheet row with the range and dilution check."
          roadmap={capabilityRoadmap.benchReading}
          admin={admin}
          instead={[
            {
              label: 'Import instrument data',
              link: { to: '/import' },
              note: 'Bring an export file in and map its columns.',
            },
            {
              label: 'Scan a code',
              link: { to: '/scan' },
              note: 'Resolve a sample or instrument by its identifier.',
            },
          ]}
        />
      </div>
    </div>
  )
}
