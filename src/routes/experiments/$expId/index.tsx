import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/experiments/$expId/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/experiments/$expId/overview', params })
  },
})
