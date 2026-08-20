import { createFileRoute, redirect } from '@tanstack/react-router'

const sections = new Set([
  'users',
  'project-access',
  'settings',
  'sessions',
  'api-credentials',
  'activity',
])

export const Route = createFileRoute('/admin/$section')({
  validateSearch: (search: Record<string, unknown>) => ({
    model: typeof search.model === 'string' ? search.model : undefined,
  }),
  beforeLoad: ({ params, search }) => {
    if (params.section === 'model-fields') {
      throw redirect({
        to: '/configure',
        search: {
          kind: 'model',
          id: undefined,
          model: search.model,
        },
      })
    }
    if (!sections.has(params.section)) {
      throw redirect({
        to: '/admin/$section',
        params: { section: 'users' },
        search: { model: undefined },
      })
    }
  },
  component: () => null,
})
