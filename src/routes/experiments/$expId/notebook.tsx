import { createFileRoute, redirect } from '@tanstack/react-router'

/** UI port (roadmap-4/ui-app3): the experiment's Notebook tab opens the working
 * record notebook, which is the canonical editor and now renders inside app-3's
 * shell. */
export const Route = createFileRoute('/experiments/$expId/notebook')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/records/$recordId/notebook',
      params: { recordId: params.expId },
    })
  },
})
