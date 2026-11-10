import { createFileRoute } from '@tanstack/react-router'

import { ExperimentSamples } from './-samples-tab'

export const Route = createFileRoute('/experiments/$expId/samples')({
  component: SamplesRoute,
})

/** The samples tab reads its experiment from the route it is mounted under. */
function SamplesRoute() {
  const { expId } = Route.useParams()

  return <ExperimentSamples expId={expId} />
}
