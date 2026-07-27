import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ActivityFeed,
  MyWorkDashboard,
  ProjectQuickAccess,
  RecentWorkTable,
  TasksPanel,
} from './index'
import type { NotebookRecord, Project } from '#/lib/notebook-data'

// TanStack Router is mocked so importing the route module (which calls
// createFileRoute at load) does not require a route tree, and Link renders
// as a plain anchor without a RouterProvider.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ useRouteContext: () => ({}) }),
  redirect: (options: unknown) => options,
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string
    params?: Record<string, string>
    children: React.ReactNode
  } & Record<string, unknown>) => {
    let href = to
    for (const [key, value] of Object.entries(params ?? {}))
      href = href.replace(`$${key}`, encodeURIComponent(value))
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

afterEach(() => {
  cleanup()
})

const baseRecord: NotebookRecord = {
  id: 'r1',
  projectId: 'p1',
  kind: 'experiment',
  identifier: 'EXP-2025-0001',
  title: 'Lentivector stability run 1',
  status: 'in-progress',
  tags: [],
  structureVersion: 1,
  metadataVersion: 1,
  createdAt: '2025-07-14T09:00:00Z',
  updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  archivedAt: null,
  deletedAt: null,
  createdByUserId: 'u1',
  updatedByUserId: null,
  properties: {},
  lockedAt: null,
  lockedByRevisionId: null,
}

const baseProject: Project = {
  id: 'p1',
  key: 'LV-001',
  title: 'Lentivector Stability Study',
  status: 'active',
  createdAt: '2025-06-01T00:00:00Z',
  updatedAt: '2025-06-02T00:00:00Z',
  archivedAt: null,
}

describe('RecentWorkTable', () => {
  it('renders rows with title, project, status and relative time', () => {
    render(
      <RecentWorkTable
        records={[baseRecord]}
        projectById={new Map([[baseProject.id, baseProject]])}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />,
    )

    expect(
      screen.getByRole('link', { name: /Lentivector stability run 1/ }),
    ).toBeTruthy()
    expect(screen.getByText('Lentivector Stability Study')).toBeTruthy()
    expect(screen.getByText('2h ago')).toBeTruthy()
    expect(screen.getByText('In progress')).toBeTruthy()
  })

  it('shows an empty state when there are no records', () => {
    render(
      <RecentWorkTable
        records={[]}
        projectById={new Map()}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />,
    )

    expect(screen.getByText('No recent work yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open projects' })).toBeTruthy()
  })

  it('shows an error state with a retry control', () => {
    render(
      <RecentWorkTable
        records={[]}
        projectById={new Map()}
        isLoading={false}
        error={new Error('boom')}
        onRetry={() => {}}
      />,
    )

    expect(screen.getByRole('alert').textContent).toBe(
      'Could not load recent work.',
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})

describe('TasksPanel / ActivityFeed', () => {
  it('renders honest empty states', () => {
    render(
      <>
        <TasksPanel />
        <ActivityFeed />
      </>,
    )
    expect(screen.getByText('No tasks assigned')).toBeTruthy()
    expect(screen.getByText('No recent activity')).toBeTruthy()
  })
})

describe('ProjectQuickAccess', () => {
  it('renders project cards with a link and key', () => {
    render(
      <ProjectQuickAccess
        projects={[baseProject]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />,
    )

    expect(
      screen.getByRole('link', { name: /Lentivector Stability Study/ }),
    ).toBeTruthy()
    expect(screen.getByText('LV-001')).toBeTruthy()
  })

  it('renders an empty state when there are no projects', () => {
    render(
      <ProjectQuickAccess
        projects={[]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />,
    )

    expect(screen.getByText('No projects yet')).toBeTruthy()
  })
})

describe('MyWorkDashboard', () => {
  it('greets the signed-in user by first name', () => {
    // The dashboard uses TanStack Query; render via a throwaway provider.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MyWorkDashboard
          context={{
            user: { name: 'Gareth Price', email: 'gareth@oxb.dev' },
            workspace: { name: 'OXB Labs', slug: 'oxb', role: 'Scientist' },
          }}
        />
      </QueryClientProvider>,
    )

    // Greeting varies by time of day; assert it addresses "Gareth".
    expect(screen.getByText(/Gareth$/)).toBeTruthy()
  })
})
