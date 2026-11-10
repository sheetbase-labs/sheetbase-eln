import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const EXPERIMENT = {
  id: 'exp-1',
  project_id: 'project-1',
  identifier: 'EXP-0001',
  title: 'AAV9 titration',
  status: 'in_progress',
  created_by_user_id: 'u1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
}

interface ExperimentsFixture {
  rows: Array<typeof EXPERIMENT>
  total: number
  denied: boolean
  page: number
}

const fixture: ExperimentsFixture = {
  rows: [],
  total: 0,
  denied: false,
  page: 1,
}

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    'http://localhost',
  )

  if (new Headers(init?.headers).has('range'))
    return Response.json([], {
      headers: {
        'content-range': fixture.total ? `0-0/${fixture.total}` : '*/0',
      },
    })

  if (fixture.denied)
    return Response.json(
      { code: 'permission_denied', message: 'no access' },
      { status: 403 },
    )

  return Response.json(url.pathname.endsWith('/records') ? fixture.rows : [])
})

const { Route } = await import('./experiments')
const { dropSharedReads } = await import('#/lib/data-client')

function renderRoute() {
  const Component = Route.options.component

  if (!Component) throw new Error('Project experiments component required')

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  client.setQueryData(['user-names', ['u1']], { u1: 'name:u1' })

  const root = createRootRoute({
    beforeLoad: () => ({ auth: { workspace: { role: 'owner' } } }),
  })

  const route = createRoute({
    getParentRoute: () => root,
    path: '/projects/$projectId/experiments',
    validateSearch: Route.options.validateSearch,
    component: Component,
  })

  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: [`/projects/project-1/experiments?page=${fixture.page}`],
    }),
  })

  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

afterAll(() => vi.unstubAllGlobals())

afterEach(() => {
  cleanup()
  dropSharedReads()
})

beforeEach(() => {
  fixture.rows = []
  fixture.total = 0
  fixture.denied = false
  fixture.page = 1
})

describe('project experiments tab (R5-SURF-02)', () => {
  it('lists the project’s experiments with a count', async () => {
    fixture.rows = [EXPERIMENT]
    fixture.total = 1

    renderRoute()

    expect(await screen.findAllByText('EXP-0001')).not.toHaveLength(0)
    expect(screen.getAllByText('AAV9 titration').length).toBeGreaterThan(0)
    expect(screen.getAllByText('name:u1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0)
  })

  it('shows the honest empty state when the project has no experiments', async () => {
    fixture.rows = []
    fixture.total = 0

    renderRoute()

    expect(await screen.findByText('No experiments yet')).toBeTruthy()
    expect(screen.queryByText('EXP-0001')).toBeNull()
  })

  it('says denied, not empty, when the read is refused', async () => {
    fixture.denied = true
    fixture.total = 0

    renderRoute()

    expect(
      await screen.findByText(/You don’t have access to this project/),
    ).toBeTruthy()
    expect(screen.queryByText('No experiments yet')).toBeNull()
  })

  it('says the page is bounded and offers the next page when there is more', async () => {
    fixture.rows = Array.from({ length: 25 }, (_, i) => ({
      ...EXPERIMENT,
      id: `exp-${i}`,
      identifier: `EXP-000${i}`,
    }))
    fixture.total = 60

    const { container } = renderRoute()

    expect(await screen.findByRole('link', { name: 'Next' })).toBeTruthy()
    expect(container.textContent).toContain('Showing 1–25 of 60 experiments')
    // On the first page "Previous" is present and disabled, not absent: a
    // control that vanishes moves the row and reads as a missing control rather
    // than a first page. Check the real router's disabled-link semantics.
    const previous = screen.getByRole('link', { name: 'Previous' })
    expect(previous.getAttribute('aria-disabled')).toBe('true')
    expect(previous.getAttribute('href')).toBeNull()
  })

  it('says a hand-edited page past the end is out of range, not empty', async () => {
    fixture.page = 9
    fixture.rows = []
    fixture.total = 30

    renderRoute()

    expect(
      await screen.findByText('That page is past the end of this list.'),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Back to the first page' }),
    ).toBeTruthy()
    expect(screen.queryByText('No experiments yet')).toBeNull()
  })
})
