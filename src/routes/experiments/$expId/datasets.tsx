import { createFileRoute } from '@tanstack/react-router'

import { ExperimentDatasets } from './-datasets-tab'

export const Route = createFileRoute('/experiments/$expId/datasets')({
  component: () => {
    const { expId } = Route.useParams()
    return <ExperimentDatasets expId={expId} />
  },
})
