import { createFileRoute } from '@tanstack/react-router'

import { LinkTab } from './-links-tab'

export const Route = createFileRoute('/experiments/$expId/files')({
  component: () => {
    const { expId } = Route.useParams()
    return (
      <LinkTab
        expId={expId}
        kind="file"
        emptyTitle="No files linked"
        emptyBody="Files attached to this experiment appear here when they are linked."
      />
    )
  },
})
