import { createFileRoute, redirect } from '@tanstack/react-router'

/** The Review tab opens on the submissions. */
export const Route = createFileRoute('/experiments/$expId/review/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/experiments/$expId/review/submissions', params })
  },
})
