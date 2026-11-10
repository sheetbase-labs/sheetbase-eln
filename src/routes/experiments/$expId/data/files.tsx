import { createFileRoute } from '@tanstack/react-router'

import { ExperimentFiles } from '../-files-tab'

export const Route = createFileRoute('/experiments/$expId/data/files')({
  component: ExperimentFilesRoute,
})

function ExperimentFilesRoute() {
  const { expId } = Route.useParams()

  return <ExperimentFiles expId={expId} />
}
