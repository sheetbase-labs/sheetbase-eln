import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './projects'
import type * as DataClient from '#/lib/data-client'
import * as projectData from '#/components/projects/project-data'
import type { ProjectsPage } from '#/components/projects/projects-page'

/** What the route hands the page: the type the real page declares for its props. */
type ProjectsPageProps = React.ComponentProps<typeof ProjectsPage>

/** The route options the file-route factory stores; this suite reads `component`. */
interface FileRouteOptions {
  component?: React.ComponentType
}

/** The props the route last handed its page. */
interface SeenPageProps {
  props: ProjectsPageProps | null
}

/** The route owns the data wiring: which read the page sees, what a stalled
 * read becomes, and the feedback a create gives. The page itself has its own
 * tests, so it is stubbed here. */
const { list, navigate, toast, seen } = vi.hoisted(() => {
  const captured: SeenPageProps = { props: null }

  return {
    list: vi.fn<() => Promise<unknown[]>>(async () => []),
    navigate: vi.fn(async () => undefined),
    toast: Object.assign(vi.fn(), { error: vi.fn() }),
    seen: captured,
  }
})

const context = {
  user: { id: 'user-1', name: 'Gareth P.' },
  workspace: { id: 'ws-1', role: 'owner' },
}

// oxlint-disable-next-line anti-slop/no-module-mocking -- The file-route factory is bound to the generated route tree at build time, and this suite renders the route component on its own with the context and search the shell would supply.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: FileRouteOptions) => ({
    useRouteContext: () => ({ context }),
    useSearch: () => ({}),
    options: config,
  }),
  Outlet: () => <div data-testid="outlet" />,
  redirect: (options: { to: string; search?: Record<string, string> }) =>
    options,
  useNavigate: () => navigate,
  useRouterState: (options: {
    select: (state: { location: { pathname: string } }) => boolean
  }) => options.select({ location: { pathname: '/projects' } }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- This suite asserts the props the route wires into its page, which the page's own suite cannot observe; the page is drawn by that suite.
vi.mock('#/components/projects/projects-page', () => ({
  ProjectsPage: (props: ProjectsPageProps) => {
    seen.props = props

    return <div data-testid="projects-page" />
  },
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Sonner mounts its own portal and store; the assertions read the toast calls, not the toast markup.
vi.mock('#/components/ui/sonner', () => ({ toast }))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The route opens its data client at module scope, so the recorded client below is the seam this suite reads; the real client has its own suite.
vi.mock('#/lib/data-client', async (importOriginal) => ({
  ...(await importOriginal<typeof DataClient>()),
  createDataClient: () => ({ list, rpc: vi.fn() }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The route's project writes go through these two module functions; the doubles answer the write and the member read the page needs, while the rest of the module stays real.
vi.mock('#/components/projects/project-data', async (importOriginal) => ({
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
        `didn’t answer within ${projectData.PROJECT_READ_DEADLINE_MS / 1000} s`,
      ),
    )

    list.mockResolvedValue([])
    await act(async () => {
      seen.props?.onRetry?.()
    })
    await waitFor(() => expect(seen.props?.error).toBeNull())
  })

  it('confirms a successful create and lands on the new project', async () => {
    renderRoute()
    await waitFor(() => expect(seen.props).not.toBeNull())
    const onCreate = seen.props?.onCreate

    await act(async () => {
      onCreate?.({
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
