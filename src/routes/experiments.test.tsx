/**
 * The experiments list's empty state: it must read as a sentence, not
 * "No all experiments" (the tab label interpolated into the copy).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './experiments'

const ExperimentsRoute = Route.options.component as React.ComponentType

const router = vi.hoisted<{ search: Record<string, unknown> }>(() => ({
  search: {},
}))
const dataClient = vi.hoisted(() => ({
  list: vi.fn(),
  count: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useSearch: () => router.search,
    useRouteContext: () => ({
      context: {
        user: { id: 'user-gp', name: 'Gareth P.' },
        workspace: { id: 'ws-1' },
      },
    }),
    options: config,
  }),
  useNavigate: () => vi.fn(),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown
  }) => select({ location: { pathname: '/experiments' } }),
  Outlet: () => null,
  redirect: (options: unknown) => options,
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="#">{children}</a>
  ),
}))

vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: dataClient }))

vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ userLabel: (id: string) => id }),
}))

function renderList() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {React.createElement(ExperimentsRoute)}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  router.search = {}
  dataClient.list.mockResolvedValue([])
  dataClient.count.mockResolvedValue(0)
  dataClient.rpc.mockImplementation(async (name: string) => {
    if (name === 'my_project_permissions')
      return [
        {
          project_id: '00000000-0000-4000-8000-000000000001',
          access_level: 'owner',
          can_view: true,
          can_edit: true,
          can_review: false,
          can_manage: true,
          client_portal: false,
        },
      ]
    return undefined
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('experiments list empty state', () => {
  it('says "No experiments" on the All tab', async () => {
    renderList()

    expect(await screen.findByText('No experiments')).toBeDefined()
    expect(screen.queryByText(/No all experiments/)).toBeNull()
    expect(
      screen.getByText(/Searched IDs, titles, projects and owners\./),
    ).toBeDefined()
  })

  it('names the view it is empty of', async () => {
    router.search = { tab: 'drafts' }
    renderList()

    await waitFor(() =>
      expect(screen.getByText('No draft experiments')).toBeDefined(),
    )
    expect(screen.queryByText(/No drafts experiments/)).toBeNull()
  })
})
