import { createFileRoute, redirect } from '@tanstack/react-router'

/** UI port (roadmap-4/ui-app3): the model frame opens on Fields. */
export const Route = createFileRoute('/models/$modelId/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/models/$modelId/fields',
      params,
    })
  },
})
