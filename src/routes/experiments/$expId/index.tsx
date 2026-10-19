import { createFileRoute, redirect } from '@tanstack/react-router'

/** The experiment page opens on its notebook. */
export const Route = createFileRoute('/experiments/$expId/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/experiments/$expId/notebook', params })
  },
})
