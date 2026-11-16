import { createFileRoute } from '@tanstack/react-router'

import { hasCapability } from '#/lib/capability'
import { ExperimentPlates } from '../-plates-tab'

export const Route = createFileRoute('/experiments/$expId/data/plates')({
  component: PlatesRoute,
})

function PlatesRoute() {
  const { expId } = Route.useParams()
  const { context } = Route.useRouteContext()

  return (
    <ExperimentPlates
      expId={expId}
      canWrite={hasCapability(context.workspace?.role, 'record.create')}
    />
  )
}
