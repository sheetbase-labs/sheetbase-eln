import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './$projectId'

const state = vi.hoisted(() => ({
  project: null as null | Record<string, unknown>,
  samples: 12,
  datasets: 3,
  milestones: 2,
  folders: 1,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ projectId: 'project-1' }),
    useRouteContext: () => ({ context: {} }),
    options: config,
  }),
  Outlet: () => <div data-testid="outlet" />,
  redirect: (options: unknown) => options,
  Link: ({
    to,
    params,
    search: _search,
    activeProps: _activeProps,
    activeOptions: _activeOptions,
    children,
    ...props
  }: {
    to?: string
    params?: Record<string, string>
    children?: React.ReactNode
  } & Record<string, unknown>) => {
    let href = typeof to === 'string' ? to : '#'
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        href = href.replace(`$${key}`, encodeURIComponent(String(value)))
      }
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

vi.mock('#/components/v3/projects/project-data', () => ({
  fetchProjectMembers: async () => [],
  fetchProjectFolders: async () =>
    Array.from({ length: state.folders }, (_, i) => ({ id: `folder-${i}` })),
  useProjectMilestones: () => ({
    data: Array.from({ length: state.milestones }, (_, i) => ({
      id: `m-${i}`,
    })),
  }),
  useProjectSummary: () => ({ project: state.project, query: {} }),
}))
vi.mock('#/components/v3/projects/project-lists', () => ({
  useProjectRecordCount: () => ({ data: state.samples }),
  useProjectDatasetCount: () => ({ data: state.datasets }),
}))
vi.mock('#/lib/identifier-resolution', () => ({
  resolveIdentifierParam: async () => undefined,
}))
vi.mock('#/lib/recents', () => ({ useRecentViewTracking: () => undefined }))

function renderRoute() {
  const Component = Route.options.component
  if (!Component) throw new Error('Project layout component required')
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Component />
    </QueryClientProvider>,
  )
}

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  state.project = {
    id: 'project-1',
    key: 'PRJ-01',
    displayId: 'PRJ-01',
    title: 'AAV9 transfer',
    status: 'active',
    clientCode: 'CL-017',
    modality: 'AAV9',
    stage: 'Tech transfer',
    leadName: 'Gareth',
    startedOn: '2026-08-03',
    archivedAt: null,
    experimentCount: 4,
  }
  state.samples = 12
  state.datasets = 3
})

describe('project header (R5-SURF-02)', () => {
  it('shows the list tabs with counts and the design’s header actions', async () => {
    renderRoute()

    for (const label of [
      'Overview',
      'Milestones',
      'Experiments',
      'Samples',
      'Datasets',
      'Folders',
      'Files',
      'Members',
      'Settings',
    ]) {
      expect(
        screen.getByRole('link', { name: new RegExp(`^${label}`) }),
      ).toBeTruthy()
    }

    // Every content tab carries its count; a tab that is the content itself
    // carries none, and Files shows the design's dash. Overview and Settings
    // stay bare, exactly as the design's own strip shows them.
    expect(screen.getByRole('link', { name: /^Milestones\s*2$/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Experiments\s*4$/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Samples\s*12$/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Datasets\s*3$/ })).toBeTruthy()
    // Folders and Members come from reads, so their counts settle a tick later.
    expect(
      await screen.findByRole('link', { name: /^Folders\s*1$/ }),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Files\s*—$/ })).toBeTruthy()
    expect(
      await screen.findByRole('link', { name: /^Members\s*0$/ }),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Overview$/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Settings$/ })).toBeTruthy()

    // Members is a tab, not a header action: one affordance, one destination.
    expect(screen.queryByRole('button', { name: 'Members' })).toBeNull()
    expect(
      screen
        .getByRole('button', { name: 'New experiment' })
        .getAttribute('href'),
    ).toBe('/experiments/new')
  })

  it('hides New experiment for an archived project', () => {
    state.project = { ...state.project, archivedAt: '2026-09-01T00:00:00Z' }
    renderRoute()
    expect(screen.queryByRole('button', { name: 'New experiment' })).toBeNull()
  })

  it('shows not found (not an empty project) when the user cannot see it', () => {
    state.project = null
    renderRoute()
    expect(screen.getByText('Project not found')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Experiments/ })).toBeNull()
  })
})
