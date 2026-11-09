import { createFileRoute } from '@tanstack/react-router'

import { ExperimentDatasets } from '../-datasets-tab'

export const Route = createFileRoute('/experiments/$expId/data/datasets')({
  component: () => {
    const { expId } = Route.useParams()

    return <ExperimentDatasets expId={expId} />
  },
})
