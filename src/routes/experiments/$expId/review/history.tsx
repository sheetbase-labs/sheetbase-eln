import { createFileRoute, redirect } from '@tanstack/react-router'

/** History moved out of Review to a tab of its own; old links land there. */
export const Route = createFileRoute('/experiments/$expId/review/history')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/experiments/$expId/history', params })
  },
})
