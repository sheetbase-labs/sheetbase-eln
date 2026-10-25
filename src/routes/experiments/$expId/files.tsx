import { createFileRoute } from '@tanstack/react-router'

import { ExperimentFiles } from './-files-tab'

export const Route = createFileRoute('/experiments/$expId/files')({
  component: () => {
    const { expId } = Route.useParams()
    return <ExperimentFiles expId={expId} />
  },
})
