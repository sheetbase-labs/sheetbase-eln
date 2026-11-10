import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * EXP-01.1 — the default record tab is the notebook.
 */
export const Route = createFileRoute('/records/$recordId/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/records/$recordId/notebook',
      params,
      search: true,
    })
  },
})
