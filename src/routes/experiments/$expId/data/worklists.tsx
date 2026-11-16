import { createFileRoute } from '@tanstack/react-router'

import { ExperimentWorklists } from '#/components/plates/experiment-worklists'
import { hasCapability } from '#/lib/capability'

function ExperimentWorklistsRoute() {
  const { expId } = Route.useParams()
  const { context } = Route.useRouteContext()

  return (
    <ExperimentWorklists
      expId={expId}
      canWrite={hasCapability(context.workspace?.role, 'record.create')}
    />
  )
}

export const Route = createFileRoute('/experiments/$expId/data/worklists')({
  component: ExperimentWorklistsRoute,
})
