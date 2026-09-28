import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/datasets/$datasetId/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/datasets/$datasetId/snapshots',
      params,
    })
  },
})
