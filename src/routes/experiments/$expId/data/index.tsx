import { createFileRoute, redirect } from '@tanstack/react-router'

/** The Data tab opens on the datasets. */
export const Route = createFileRoute('/experiments/$expId/data/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/experiments/$expId/data/datasets', params })
  },
})
