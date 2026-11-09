import { createFileRoute, redirect } from '@tanstack/react-router'

import { IncidentLog } from '#/components/incidents/incident-log'
import { hasCapability } from '#/lib/capability'
import { signInRedirect } from '#/lib/sign-in-redirect'

/**
 * Incidents: every record of the record models ticked as an incident log
 * (migration 0081). There is no fixed incident type; a lab chooses what it logs.
 */
export const Route = createFileRoute('/incidents')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: IncidentsPage,
})

function IncidentsPage() {
  const { context } = Route.useRouteContext()

  return (
    <IncidentLog
      canWrite={hasCapability(context.workspace?.role, 'record.create')}
      canEditModels={hasCapability(context.workspace?.role, 'schema.edit')}
    />
  )
}
