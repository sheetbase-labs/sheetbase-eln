import { createFileRoute, redirect } from '@tanstack/react-router'

/** Samples, Datasets and Files are sections of the Links tab. */
export const Route = createFileRoute('/experiments/$expId/files')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/experiments/$expId/links', params })
  },
})
