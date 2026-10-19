/**
 * The evidence view of a signed revision lives at `/evidence/$revisionId`, with
 * its signatures and drift in the side inspector. This address is kept so old
 * links and bookmarks land there.
 */
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/records/$recordId/evidence/$revisionId')(
  {
    beforeLoad: ({ params }) => {
      throw redirect({
        to: '/evidence/$revisionId',
        params: { revisionId: params.revisionId },
        replace: true,
      })
    },
  },
)
