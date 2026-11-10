import { createFileRoute } from '@tanstack/react-router'

import { LinksPanel } from '../-links-tab'

export const Route = createFileRoute('/experiments/$expId/data/links')({
  component: LinksRoute,
})

function LinksRoute() {
  const { expId } = Route.useParams()

  return <LinksPanel expId={expId} />
}
