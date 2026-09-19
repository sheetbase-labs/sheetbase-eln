import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Eye } from 'lucide-react'

import {
  ActivityFeed,
  FavouritesSection,
  MentionsPanel,
  MyPrioritiesPanel,
  MyWorkDashboard,
  NeedsAttention,
  PinnedRecordsPanel,
  ProjectQuickAccess,
  RecentSection,
  RecentWorkTable,
  UpcomingApprovalsPanel,
} from './index'
import type { FavouriteItem } from '#/lib/favourites'
import type { NotebookRecord, Project } from '#/lib/notebook-data'
import type { RecentItem } from '#/lib/recents'
import type {
  DashboardActivityItem,
  DashboardMentionItem,
  DashboardPinnedItem,
} from '#/lib/dashboard-data'
import type { ReviewItem } from '#/lib/reviews'

// TanStack Router is mocked so importing the route module (which calls
// createFileRoute at load) does not require a route tree, and Link renders
// as a plain anchor without a RouterProvider.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ useRouteContext: () => ({}) }),
  redirect: (options: unknown) => options,
  useRouter: () => ({ invalidate: vi.fn() }),
  useNavigate: () => vi.fn(),
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

const baseActivityItem: DashboardActivityItem = {
  id: 'ce-1',
  operation: 'update',
  entityType: 'record',
  actorUserId: 'u1',
  recordId: 'r1',
  projectId: 'p1',
  createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  payload: { title: 'Lentivector stability run 1' },
}

const baseMention: DashboardMentionItem = {
  id: 'c-1',
  recordId: 'r1',
  revisionId: 'rev-1',
  body: 'Can you review this section?',
  authorUserId: 'u2',
  state: 'open',
  createdAt: new Date(Date.now() - 5_400_000).toISOString(),
}

const baseReview: ReviewItem = {
  id: 'sub-1',
  recordId: 'r1',
  revisionId: 'rev-1',
  state: 'submitted',
  workflowDefinitionKey: 'default-scientific-review',
  workflowDefinitionVersion: 1,
  assignedReviewerUserIds: ['u1'],
  submittedByUserId: 'u2',
  submittedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  updatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  recordIdentifier: 'EXP-2025-0001',
  recordTitle: 'Lentivector stability run 1',
  recordKind: 'experiment',
  recordStatus: 'review',
  projectId: 'p1',
  projectKey: 'LV-001',
  projectTitle: 'Lentivector Stability Study',
  currentStep: {
    key: 'scientific-review',
    label: 'Scientific review',
    required: true,
  },
  status: 'submitted',
  priority: 'low',
  isOverdue: false,
  isWithdrawn: false,
}

const basePinnedItem: DashboardPinnedItem = {
  record: baseRecord,
  project: baseProject,
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

  it('renders pin buttons when onTogglePin is provided', () => {
    render(
      <RecentWorkTable
        records={[baseRecord]}
        projectById={new Map([[baseProject.id, baseProject]])}
        isLoading={false}
        error={null}
        onRetry={() => {}}
        pinnedIds={[]}
        onTogglePin={() => {}}
      />,
    )

    expect(screen.getByRole('button', { name: 'Pin record' })).toBeTruthy()
  })
})

describe('ActivityFeed', () => {
  const stubUserLabel = (id: string) => id

  it('renders real activity items from change events', () => {
    render(
      <ActivityFeed
        items={[baseActivityItem]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
        currentUserId="u1"
        userLabel={stubUserLabel}
      />,
    )

    // The actor is "You" since actorUserId matches currentUserId.
    expect(screen.getByText(/You/)).toBeTruthy()
    expect(screen.getByText(/updated record/)).toBeTruthy()
    expect(screen.getByText('1h ago')).toBeTruthy()
  })

  it('shows an honest empty state when there is no activity', () => {
    render(
      <ActivityFeed
        items={[]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
        currentUserId="u1"
        userLabel={stubUserLabel}
      />,
    )

    expect(screen.getByText('No recent activity')).toBeTruthy()
  })

  it('shows an error state with retry', () => {
    render(
      <ActivityFeed
        items={[]}
        isLoading={false}
        error={new Error('boom')}
        onRetry={() => {}}
        currentUserId="u1"
        userLabel={stubUserLabel}
      />,
    )

    expect(screen.getByRole('alert').textContent).toBe(
      'Could not load activity.',
    )
  })
})

describe('NeedsAttention', () => {
  it('hides "View all" in the all-clear state', () => {
    render(<NeedsAttention items={[]} isLoading={false} />)
    expect(screen.getByText('All clear')).toBeTruthy()
    expect(screen.queryByText('View all')).toBeNull()
  })

  it('shows "View all" when items need attention', () => {
    render(
      <NeedsAttention
        items={[
          {
            id: 'a1',
            tone: 'violet',
            icon: Eye,
            title: 'Review requested: Lentivector stability run 1',
            meta: 'u2 submitted for your sign-off · overdue',
            actionLabel: 'Open review',
            to: '/reviews',
            primaryAction: true,
          },
        ]}
        isLoading={false}
      />,
    )
    expect(screen.getByText('View all')).toBeTruthy()
    expect(screen.getByText('Open review')).toBeTruthy()
  })
})

describe('MentionsPanel', () => {
  const stubUserLabel = (id: string) => id

  it('renders mention items with body and author', () => {
    render(
      <MentionsPanel
        mentions={[baseMention]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
        currentUserId="u1"
        userLabel={stubUserLabel}
      />,
    )

    expect(screen.getByText('Can you review this section?')).toBeTruthy()
    // Author u2 is shown as truncated id.
    expect(screen.getByText(/u2/)).toBeTruthy()
  })

  it('shows an empty state when there are no mentions', () => {
    render(
      <MentionsPanel
        mentions={[]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
        currentUserId="u1"
        userLabel={stubUserLabel}
      />,
    )

    expect(screen.getByText('No mentions yet')).toBeTruthy()
  })
})

describe('MyPrioritiesPanel', () => {
  it('renders pending reviews as numbered priorities', () => {
    render(<MyPrioritiesPanel priorities={[baseReview]} isLoading={false} />)

    expect(screen.getByText('Review EXP-2025-0001')).toBeTruthy()
    expect(screen.getByText('Under review')).toBeTruthy()
  })

  it('shows an empty state when there are no priorities', () => {
    render(<MyPrioritiesPanel priorities={[]} isLoading={false} />)

    expect(screen.getByText('No priorities')).toBeTruthy()
  })
})

describe('PinnedRecordsPanel', () => {
  it('renders pinned record shortcuts', () => {
    render(
      <PinnedRecordsPanel
        pinnedRecords={[basePinnedItem]}
        isLoading={false}
        onUnpin={() => {}}
      />,
    )

    expect(
      screen.getByRole('link', { name: /Lentivector stability run 1/ }),
    ).toBeTruthy()
    expect(screen.getByText(/EXP-2025-0001/)).toBeTruthy()
  })

  it('shows an empty state when nothing is pinned', () => {
    render(
      <PinnedRecordsPanel
        pinnedRecords={[]}
        isLoading={false}
        onUnpin={() => {}}
      />,
    )

    expect(screen.getByText('No pinned items')).toBeTruthy()
  })
})

describe('UpcomingApprovalsPanel', () => {
  it('renders pending reviews with ageing info', () => {
    render(
      <UpcomingApprovalsPanel
        pendingReviews={[baseReview]}
        isLoading={false}
      />,
    )

    expect(screen.getByText('EXP-2025-0001')).toBeTruthy()
    // 3 days old → "3d ago"
    expect(screen.getByText('3d ago')).toBeTruthy()
  })

  it('shows an empty state when there are no upcoming approvals', () => {
    render(<UpcomingApprovalsPanel pendingReviews={[]} isLoading={false} />)

    expect(screen.getByText('No upcoming approvals')).toBeTruthy()
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
            userId: 'u1',
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

describe('RecentSection', () => {
  const recentItem = (
    overrides: Partial<RecentItem> & Pick<RecentItem, 'kind' | 'id'>,
  ): RecentItem => ({
    label: 'Lentivector stability run 1',
    identifier: 'EXP-2025-0001',
    destination: '/records/r1',
    signal: 'edited',
    lastActivityAt: new Date(Date.now() - 3_600_000).toISOString(),
    viewedAt: null,
    editedAt: null,
    ...overrides,
  })

  it('renders recent items with canonical labels, kind and signal', () => {
    render(
      <RecentSection
        items={[
          recentItem({ kind: 'record', id: 'r1' }),
          recentItem({
            kind: 'sheet',
            id: 's1',
            label: 'Dose response',
            identifier: null,
            destination: '/sheets/s1',
            signal: 'viewed',
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />,
    )

    const recordLink = screen.getByRole('link', {
      name: /Lentivector stability run 1/,
    })
    expect(recordLink.getAttribute('href')).toBe('/records/r1')
    expect(screen.getByText('Edited')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Dose response/ })).toBeTruthy()
    expect(screen.getByText('Viewed')).toBeTruthy()
  })

  it('renders the reviewed signal for objects under review', () => {
    render(
      <RecentSection
        items={[recentItem({ kind: 'record', id: 'r1', signal: 'reviewed' })]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />,
    )
    expect(screen.getByText('In review')).toBeTruthy()
  })

  it('shows an empty state when there is nothing to resume', () => {
    render(
      <RecentSection
        items={[]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />,
    )
    expect(screen.getByText('Nothing recent yet')).toBeTruthy()
  })

  it('shows an error state with a retry control', () => {
    render(
      <RecentSection
        items={[]}
        isLoading={false}
        error={new Error('boom')}
        onRetry={() => {}}
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe(
      'Could not load recent items.',
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})

describe('FavouritesSection', () => {
  const favouriteItem = (
    overrides: Partial<FavouriteItem> & Pick<FavouriteItem, 'kind' | 'id'>,
  ): FavouriteItem => ({
    label: 'Lentivector stability run 1',
    identifier: 'EXP-2025-0001',
    destination: '/records/r1',
    createdAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
    ...overrides,
  })

  it('renders favourites with canonical labels, kind and destination', () => {
    render(
      <FavouritesSection
        items={[
          favouriteItem({ kind: 'record', id: 'r1' }),
          favouriteItem({
            kind: 'project',
            id: 'p1',
            label: 'Lentivector Stability Study',
            identifier: 'LV-001',
            destination: '/projects/p1',
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    )

    expect(
      screen.getByRole('link', { name: /Lentivector stability run 1/ }),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('link', { name: /Lentivector Stability Study/ })
        .getAttribute('href'),
    ).toBe('/projects/p1')
    // The meta line carries the kind label and the secondary identifier.
    expect(screen.getByText(/Record · EXP-2025-0001/)).toBeTruthy()
    expect(screen.getByText(/Project · LV-001/)).toBeTruthy()
  })

  it('exposes an unfavourite control for each item', () => {
    const onRemove = vi.fn()
    render(
      <FavouritesSection
        items={[favouriteItem({ kind: 'sheet', id: 's1' })]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
        onRemove={onRemove}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }))
    expect(onRemove).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'sheet', id: 's1' }),
    )
  })

  it('shows an honest empty state pointing at the star affordance', () => {
    render(
      <FavouritesSection
        items={[]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    )
    expect(screen.getByText('No favourites yet')).toBeTruthy()
  })

  it('shows an error state with a retry control', () => {
    render(
      <FavouritesSection
        items={[]}
        isLoading={false}
        error={new Error('boom')}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe(
      'Could not load favourites.',
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
