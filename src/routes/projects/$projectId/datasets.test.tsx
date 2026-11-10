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
import { z } from 'zod'

const DATASET = {
  id: 'ds-1',
  display_id: 'DS-0001',
  name: 'Plate read',
  model: 'ViCell v2',
  project_id: 'project-1',
  created_by_user_id: 'u1',
  row_count: '10',
  issue_count: '0',
  out_of_range_count: '0',
  missing_unit_count: '0',
  missing_unit_fields: null,
  experiment_display_id: 'EXP-0001',
  review_state: null,
  updated_at: '2026-01-02T00:00:00Z',
  archived_at: null,
}

interface DatasetsFixture {
  rows: Array<typeof DATASET>
  total: number
  denied: boolean
  page: number
  requests: Array<{ p_project_id: string }>
}

const fixture: DatasetsFixture = {
  rows: [],
  total: 0,
  denied: false,
  page: 1,
  requests: [],
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

  if (url.pathname.endsWith('/dataset_list_summary')) {
    fixture.requests.push(
      z
        .object({ p_project_id: z.string() })
        .parse(await new Response(init?.body).json()),
    )

    return Response.json(fixture.rows)
  }

  return Response.json([])
})

const { Route } = await import('./datasets')
const { dropSharedReads } = await import('#/lib/data-client')

function renderRoute() {
  const Component = Route.options.component

  if (!Component) throw new Error('Project datasets component required')

  const root = createRootRoute()

  const route = createRoute({
    getParentRoute: () => root,
    path: '/projects/$projectId/datasets',
    validateSearch: Route.options.validateSearch,
    component: Component,
  })

  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: [`/projects/project-1/datasets?page=${fixture.page}`],
    }),
  })

  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
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
  fixture.requests = []
})

describe('project datasets tab (R5-SURF-02)', () => {
  it('lists the project’s datasets with a count', async () => {
    fixture.rows = [DATASET]
    fixture.total = 1

    renderRoute()

    expect(await screen.findAllByText('DS-0001')).not.toHaveLength(0)
    expect(screen.getAllByText('Plate read').length).toBeGreaterThan(0)
    expect(screen.getAllByText('ViCell v2').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Valid').length).toBeGreaterThan(0)
  })

  it('asks the RPC for the project, never the whole registry', async () => {
    fixture.rows = [DATASET]
    fixture.total = 1

    renderRoute()

    await screen.findAllByText('DS-0001')
    expect(fixture.requests).toContainEqual({ p_project_id: 'project-1' })
  })

  it('shows the honest empty state when the project has no datasets', async () => {
    fixture.rows = []
    fixture.total = 0

    renderRoute()

    expect(await screen.findByText('No datasets yet')).toBeTruthy()
    expect(screen.queryByText('DS-0001')).toBeNull()
  })

  it('says denied, not empty, when the read is refused', async () => {
    fixture.denied = true
    fixture.total = 0

    renderRoute()

    expect(
      await screen.findByText(/You don’t have access to this project/),
    ).toBeTruthy()
    expect(screen.queryByText('No datasets yet')).toBeNull()
  })

  it('says the page is bounded and offers the next page when there is more', async () => {
    fixture.rows = Array.from({ length: 25 }, (_, i) => ({
      ...DATASET,
      id: `ds-${i}`,
      display_id: `DS-000${i}`,
    }))
    fixture.total = 40

    const { container } = renderRoute()

    expect(await screen.findByRole('link', { name: 'Next' })).toBeTruthy()
    expect(container.textContent).toContain('Showing 1–25 of 40 datasets')
  })

  it('says a hand-edited page past the end is out of range, not empty', async () => {
    fixture.page = 9
    fixture.rows = []
    fixture.total = 40

    renderRoute()

    expect(
      await screen.findByText('That page is past the end of this list.'),
    ).toBeTruthy()
    expect(screen.queryByText('No datasets yet')).toBeNull()
  })
})
