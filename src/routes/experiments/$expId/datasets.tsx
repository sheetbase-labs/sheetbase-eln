import { createFileRoute } from '@tanstack/react-router'

import { LinkTab } from './-links-tab'

export const Route = createFileRoute('/experiments/$expId/datasets')({
  component: () => {
    const { expId } = Route.useParams()
    return (
      <LinkTab
        expId={expId}
        kind="dataset"
        emptyTitle="No datasets linked"
        emptyBody="Datasets produced by this experiment appear here when they are linked."
      />
    )
  },
})
