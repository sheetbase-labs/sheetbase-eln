import { createFileRoute, redirect } from '@tanstack/react-router'

export const adminSectionKeys: Record<string, true> = {
  dashboard: true,
  users: true,
  'project-access': true,
  settings: true,
  sessions: true,
  'api-credentials': true,
  connectors: true,
  pipelines: true,
  extensions: true,
  storage: true,
  usage: true,
  activity: true,
  diagnostics: true,
  deployment: true,
}

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
    if (!adminSectionKeys[params.section]) {
      throw redirect({
        to: '/admin/$section',
        params: { section: 'dashboard' },
        search: { model: undefined },
      })
    }
  },
  component: () => null,
})
