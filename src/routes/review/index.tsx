import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * `/review` has no page of its own: a review is opened by revision
 * (`/review/$revisionId`). The bare address is the natural thing to type or
 * bookmark for "what is waiting for my review", so it opens the Inbox filtered
 * to reviews rather than the not-found screen.
 */
export const Route = createFileRoute('/review/')({
  beforeLoad: () => {
    throw redirect({
      to: '/inbox',
      search: { tab: 'needs-action', type: 'reviews' },
      replace: true,
    })
  },
})
