import { createFileRoute } from '@tanstack/react-router'

import { hasCapability } from '#/lib/capability'
import { ExperimentSeries } from './-series-tab'

/** The Series tab: the experiments grouped under this one, in order. */
export const Route = createFileRoute('/experiments/$expId/series')({
  component: SeriesTab,
})

function SeriesTab() {
  const { expId } = Route.useParams()
  const { context } = Route.useRouteContext()
  return (
    <ExperimentSeries
      expId={expId}
      canWrite={hasCapability(context.workspace?.role, 'record.create')}
    />
  )
}
