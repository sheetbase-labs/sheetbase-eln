import { createFileRoute } from '@tanstack/react-router'

import { LinksPanel } from './-links-tab'

export const Route = createFileRoute('/experiments/$expId/files')({
  component: () => {
    const { expId } = Route.useParams()
    return <LinksPanel expId={expId} only="file" />
  },
})
