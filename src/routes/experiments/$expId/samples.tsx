import { createFileRoute } from '@tanstack/react-router'

import { ExperimentSamples } from './-samples-tab'

export const Route = createFileRoute('/experiments/$expId/samples')({
  component: () => {
    const { expId } = Route.useParams()
    return <ExperimentSamples expId={expId} />
  },
})
