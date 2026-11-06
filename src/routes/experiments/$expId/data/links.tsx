import { createFileRoute } from '@tanstack/react-router'

import { LinksPanel } from './-links-tab'

export const Route = createFileRoute('/experiments/$expId/links')({
  component: () => {
    const { expId } = Route.useParams()
    return <LinksPanel expId={expId} />
  },
})
