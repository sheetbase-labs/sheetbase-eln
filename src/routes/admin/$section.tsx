import { createFileRoute, redirect } from '@tanstack/react-router'

const sections = new Set([
  'users',
  'project-access',
  'model-fields',
  'settings',
  'sessions',
  'api-credentials',
  'activity',
])

export const Route = createFileRoute('/admin/$section')({
  beforeLoad: ({ params }) => {
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
