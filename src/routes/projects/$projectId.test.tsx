import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './$projectId'

const state = vi.hoisted(() => ({
  project: null as null | Record<string, unknown>,
  samples: 12,
  datasets: 3,
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
  it('shows the list tabs with counts and the design’s header actions', () => {
    renderRoute()

    for (const label of [
      'Overview',
      'Milestones',
      'Experiments',
      'Samples',
      'Datasets',
      'Folders',
      'Members',
      'Settings',
    ]) {
      expect(
        screen.getByRole('link', { name: new RegExp(`^${label}`) }),
      ).toBeTruthy()
    }

    // Counts: experiments from project_list_summary, samples/datasets from the
    // same queries as their tabs.
    expect(screen.getByRole('link', { name: /^Experiments\s*4$/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Samples\s*12$/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Datasets\s*3$/ })).toBeTruthy()

    expect(
      screen.getByRole('button', { name: 'Members' }).getAttribute('href'),
    ).toBe('/projects/project-1/members')
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
