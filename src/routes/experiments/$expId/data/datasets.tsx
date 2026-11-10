import { createFileRoute } from '@tanstack/react-router'

import { ExperimentDatasets } from '../-datasets-tab'

function ExperimentDatasetsRoute() {
  const { expId } = Route.useParams()

  return <ExperimentDatasets expId={expId} />
}

export const Route = createFileRoute('/experiments/$expId/data/datasets')({
  component: ExperimentDatasetsRoute,
})
