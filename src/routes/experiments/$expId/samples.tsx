import { createFileRoute } from '@tanstack/react-router'

import { LinkTab } from './links-tab'

export const Route = createFileRoute('/experiments/$expId/samples')({
  component: () => {
    const { expId } = Route.useParams()
    return (
      <LinkTab
        expId={expId}
        kind="sample"
        emptyTitle="No samples linked"
        emptyBody="Samples used or produced by this experiment appear here when they are linked."
      />
    )
  },
})
