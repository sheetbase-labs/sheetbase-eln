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

const SAMPLE = {
  id: 'smp-1',
  workspace_id: 'ws',
  project_id: 'project-1',
  folder_id: null,
  kind: 'sample',
  identifier: 'SMP-0001',
  title: 'Lot A',
  status: 'available',
  tags: [],
  structure_version: 1,
  metadata_version: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  archived_at: null,
  deleted_at: null,
  created_by_user_id: 'u1',
  updated_by_user_id: null,
  properties: {
    sampleType: 'Serum',
    quantity: 4,
    quantityUnit: 'mL',
    storageLocation: 'Freezer 2',
  },
  custom_fields: {},
  locked_at: null,
  locked_by_revision_id: null,
}

interface SamplesFixture {
  rows: Array<typeof SAMPLE>
  total: number
  denied: boolean
  page: number
}

const fixture: SamplesFixture = { rows: [], total: 0, denied: false, page: 1 }

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

const { Route } = await import('./samples')
const { dropSharedReads } = await import('#/lib/data-client')

function renderRoute() {
  const Component = Route.options.component

  if (!Component) throw new Error('Project samples component required')

  const root = createRootRoute()

  const route = createRoute({
    getParentRoute: () => root,
    path: '/projects/$projectId/samples',
    validateSearch: Route.options.validateSearch,
    component: Component,
  })

  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: [`/projects/project-1/samples?page=${fixture.page}`],
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
})

describe('project samples tab (R5-SURF-02)', () => {
  it('lists the project’s samples with a count', async () => {
    fixture.rows = [SAMPLE]
    fixture.total = 1

    renderRoute()

    expect(await screen.findAllByText('SMP-0001')).not.toHaveLength(0)
    expect(screen.getAllByText('Lot A').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Serum').length).toBeGreaterThan(0)
    expect(screen.getAllByText('4 mL').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Stored').length).toBeGreaterThan(0)
  })

  it('shows the honest empty state when the project has no samples', async () => {
    fixture.rows = []
    fixture.total = 0

    renderRoute()

    expect(await screen.findByText('No samples yet')).toBeTruthy()
    expect(screen.queryByText('SMP-0001')).toBeNull()
  })

  it('says denied, not empty, when the read is refused', async () => {
    fixture.denied = true
    fixture.total = 0

    renderRoute()

    expect(
      await screen.findByText(/You don’t have access to this project/),
    ).toBeTruthy()
    expect(screen.queryByText('No samples yet')).toBeNull()
  })

  it('says the page is bounded and offers the next page when there is more', async () => {
    fixture.rows = Array.from({ length: 25 }, (_, i) => ({
      ...SAMPLE,
      id: `smp-${i}`,
      identifier: `SMP-000${i}`,
    }))
    fixture.total = 30

    const { container } = renderRoute()

    expect(await screen.findByRole('link', { name: 'Next' })).toBeTruthy()
    expect(container.textContent).toContain('Showing 1–25 of 30 samples')
  })

  it('says a hand-edited page past the end is out of range, not empty', async () => {
    fixture.page = 9
    fixture.rows = []
    fixture.total = 30

    renderRoute()

    expect(
      await screen.findByText('That page is past the end of this list.'),
    ).toBeTruthy()
    expect(screen.queryByText('No samples yet')).toBeNull()
  })
})
