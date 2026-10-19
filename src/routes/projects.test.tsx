import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './projects'
import type * as DataClient from '#/lib/data-client'
import * as projectData from '#/components/v3/projects/project-data'

/** The route owns the data wiring: which read the page sees, what a stalled
 * read becomes, and the feedback a create gives. The page itself has its own
 * tests, so it is stubbed here. */
const { list, navigate, toast, seen } = vi.hoisted(() => ({
  list: vi.fn<() => Promise<unknown[]>>(async () => []),
  navigate: vi.fn(async () => undefined),
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
  seen: { props: null as null | Record<string, unknown> },
}))

const context = {
  user: { id: 'user-1', name: 'Gareth P.' },
  workspace: { id: 'ws-1', role: 'owner' },
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useRouteContext: () => ({ context }),
    useSearch: () => ({}),
    options: config,
  }),
  Outlet: () => <div data-testid="outlet" />,
  redirect: (options: unknown) => options,
  useNavigate: () => navigate,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: '/projects' } }),
}))

vi.mock('#/components/v3/projects/projects-page', () => ({
  ProjectsPage: (props: Record<string, unknown>) => {
    seen.props = props
    return <div data-testid="projects-page" />
  },
}))

vi.mock('#/components/v3/ui/sonner', () => ({ toast }))

vi.mock('#/lib/data-client', async (importOriginal) => ({
  ...(await importOriginal<typeof DataClient>()),
  createDataClient: () => ({ list, rpc: vi.fn() }),
}))

vi.mock('#/components/v3/projects/project-data', async (importOriginal) => ({
  ...(await importOriginal<typeof projectData>()),
  createProject: vi.fn(async () => ({ id: 'project-1', revision: '1' })),
  fetchWorkspaceMemberIdentities: async () => [],
}))

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  list.mockResolvedValue([])
  seen.props = null
})

function renderRoute() {
  const Component = Route.options.component
  if (!Component) throw new Error('Projects route component required')
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Component />
    </QueryClientProvider>,
  )
}

describe('projects route', () => {
  it('turns a stalled project read into a stated failure the page can retry', async () => {
    vi.useFakeTimers()
    try {
      list.mockImplementation(() => new Promise(() => {}))
      renderRoute()
      expect(seen.props?.loading).toBe(true)
      expect(seen.props?.error).toBeNull()

      // The read never answers: after the deadline (and the one silent retry)
      // the page is told, instead of "Loading projects…" for ever.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          projectData.PROJECT_READ_DEADLINE_MS * 2 + 2_000,
        )
      })
    } finally {
      vi.useRealTimers()
    }
    expect(seen.props?.loading).toBe(false)
    expect(String(seen.props?.error)).toMatch(
      new RegExp(
        `did not answer within ${projectData.PROJECT_READ_DEADLINE_MS / 1000} s`,
      ),
    )

    list.mockResolvedValue([])
    await act(async () => {
      const onRetry = seen.props?.onRetry as () => void
      onRetry()
    })
    await waitFor(() => expect(seen.props?.error).toBeNull())
  })

  it('confirms a successful create and lands on the new project', async () => {
    renderRoute()
    await waitFor(() => expect(seen.props).not.toBeNull())
    const onCreate = seen.props?.onCreate as (input: unknown) => void
    await act(async () => {
      onCreate({
        title: 'QA2 probe',
        clientId: null,
        modality: null,
        stage: null,
        leadUserId: null,
        defaultReviewerUserId: null,
        agreementReference: null,
        startedOn: null,
      })
    })
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Project “QA2 probe” created'),
    )
    expect(navigate).toHaveBeenCalledWith({
      to: '/projects/$projectId',
      params: { projectId: 'project-1' },
    })
  })
})
