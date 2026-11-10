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

let visible = true
let archivedAt: string | null = null

vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    'http://localhost',
  )

  if (url.pathname.endsWith('/project_list_summary'))
    return Response.json(
      visible
        ? [
            {
              id: 'project-1',
              key: 'PRJ-01',
              display_id: 'PRJ-01',
              title: 'AAV9 transfer',
              status: 'active',
              client_code: 'CL-017',
              modality: 'AAV9',
              stage: 'Tech transfer',
              lead_name: 'Gareth',
              started_on: '2026-08-03',
              archived_at: archivedAt,
              experiment_count: 4,
              updated_at: '2026-08-03T00:00:00Z',
            },
          ]
        : [],
    )

  if (url.pathname.endsWith('/records') || url.pathname.endsWith('/datasets'))
    return Response.json([], {
      headers: {
        'Content-Range': `*/${url.pathname.endsWith('/records') ? 12 : 3}`,
      },
    })

  if (url.pathname.endsWith('/study_tasks'))
    return Response.json(
      [0, 1].map((i) => ({
        id: `m-${i}`,
        task_type: 'milestone',
        title: `Milestone ${i}`,
        status: 'todo',
        due_at: null,
        timezone: 'UTC',
      })),
    )

  return Response.json([])
})

const { Route } = await import('./$projectId')
const { dropSharedReads } = await import('#/lib/data-client')

function renderRoute() {
  const Component = Route.options.component

  if (!Component) throw new Error('Project layout component required')

  const context = {
    user: { id: 'gareth' },
    workspace: { id: 'ws', role: 'member' },
  }

  const root = createRootRoute({ beforeLoad: () => ({ auth: context }) })

  const route = createRoute({
    getParentRoute: () => root,
    path: '/projects/$projectId',
    beforeLoad: () => ({ context }),
    component: Component,
  })

  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/projects/project-1'] }),
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

afterEach(() => {
  cleanup()
  dropSharedReads()
})

afterAll(() => vi.unstubAllGlobals())

beforeEach(() => {
  visible = true
  archivedAt = null
})

describe('project header (R5-SURF-02)', () => {
  it('shows the list tabs with counts and the design’s header actions', async () => {
    renderRoute()
    await screen.findByRole('link', { name: /^Milestones\s*2$/ })
    await screen.findByRole('link', { name: /^Samples\s*12$/ })
    await screen.findByRole('link', { name: /^Datasets\s*3$/ })

    for (const label of [
      'Overview',
      'Milestones',
      'Experiments',
      'Samples',
      'Datasets',
      'Files',
      'Settings',
    ]) {
      expect(
        screen.getByRole('link', { name: new RegExp(`^${label}`) }),
      ).toBeTruthy()
    }

    // Every content tab carries its count; a tab that is the content itself
    // carries none. Overview and Settings
    // stay bare, exactly as the design's own strip shows them.
    expect(screen.getByRole('link', { name: /^Milestones\s*2$/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Experiments\s*4$/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Samples\s*12$/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Datasets\s*3$/ })).toBeTruthy()
    // Files holds the folders and sheets too, so it carries no count of its own.
    expect(screen.getByRole('link', { name: /^Files$/ })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Folders/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Members/ })).toBeNull()
    expect(screen.getByRole('link', { name: /^Overview$/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Settings$/ })).toBeTruthy()

    expect(screen.queryByRole('button', { name: 'Members' })).toBeNull()
    expect(
      screen
        .getByRole('button', { name: 'New experiment' })
        .getAttribute('href'),
    ).toBe('/experiments/new?project=project-1')
  })

  it('hides New experiment for an archived project', async () => {
    archivedAt = '2026-09-01T00:00:00Z'
    renderRoute()
    await screen.findByText('AAV9 transfer')
    expect(screen.queryByRole('button', { name: 'New experiment' })).toBeNull()
  })

  it('shows not found (not an empty project) when the user cannot see it', async () => {
    visible = false
    renderRoute()
    expect(await screen.findByText('Project not found')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Experiments/ })).toBeNull()
  })
})
