/**
 * R5-HOME-01 — Home's pace states.
 *
 * These render the real route over the real read models: only the `/api/db`
 * HTTP boundary is faked, so the count queries, the recents derivation, the
 * coming-up window, the project approval counts and the pace ladder all run
 * for real. Quiet, near-quiet and busy are then three different count sets.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as router from '@tanstack/react-router'
import type * as projectData from '#/components/v3/projects/project-data'
import type * as notebookData from '#/lib/notebook-data'

import { Home, Route } from './index'

const fixture = vi.hoisted(() => ({
  inbox: 0,
  reviews: 0,
  datasetsWithErrors: 0,
  unread: 0,
  hasRecents: true,
  shellInbox: null as string | null,
  failing: [] as string[],
}))

const fake = vi.hoisted(() => {
  // Dates are relative to the run so the "next two weeks" window always holds
  // the rows without freezing the clock the page reads.
  const at = (hours: number) =>
    new Date(Date.now() + hours * 3_600_000).toISOString()
  const on = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

  const list = async (resource: string, query = '') => {
    if (fixture.failing.includes(resource)) throw new Error('unavailable')
    switch (resource) {
      case 'workspace_settings':
        return [
          {
            site: null,
            timezone: 'Europe/London',
            date_format: 'd MMM yyyy',
            number_format: 'decimal',
            publication_approval_required: false,
            allow_offline_editing: true,
            id_prefixes: null,
            workspaces: { name: 'Process Development' },
          },
        ]
      case 'recently_viewed':
        return fixture.hasRecents
          ? [
              {
                user_id: 'user-1',
                object_kind: 'record',
                object_id: 'rec-1',
                viewed_at: at(-1),
              },
              {
                user_id: 'user-1',
                object_kind: 'record',
                object_id: 'rec-2',
                viewed_at: at(-2),
              },
            ]
          : []
      case 'records':
        if (query.includes('planned_end=gte')) {
          return [
            {
              id: 'rec-3',
              identifier: 'EXP-0149',
              title: 'Clarification confirmation run',
              project_id: '00000000-0000-4000-8000-000000000320',
              planned_end: on(5),
            },
          ]
        }
        if (query.includes('id=in.')) {
          return [
            {
              id: 'rec-1',
              kind: 'experiment',
              identifier: 'EXP-0145',
              title: 'Harvest clarification: 50 L confirmation run',
              status: 'draft',
              project_id: '00000000-0000-4000-8000-000000000320',
              archived_at: null,
              deleted_at: null,
            },
            {
              id: 'rec-2',
              kind: 'experiment',
              identifier: 'EXP-0140',
              title: 'VCD readings, day 6',
              status: 'approved',
              project_id: '00000000-0000-4000-8000-000000000320',
              archived_at: null,
              deleted_at: null,
            },
            {
              id: 'rec-review',
              kind: 'experiment',
              identifier: 'EXP-0131',
              title: 'Stability hold',
              status: 'in_review',
              project_id: '00000000-0000-4000-8000-000000000320',
              archived_at: null,
              deleted_at: null,
            },
          ]
        }
        return []
      case 'calendar_bookings':
        return [
          {
            id: 'booking-1',
            workspace_id: 'ws-1',
            resource_id: 'resource-1',
            project_id: null,
            title: 'inoculation, AMB-25-121',
            status: 'confirmed',
            all_day: false,
            starts_at: at(36),
            ends_at: at(38),
            timezone: 'Europe/London',
            location: 'Bay 2',
            color: null,
            notes: null,
            linked_experiment_record_id: null,
            linked_experiment_identifier: null,
            linked_experiment_title: null,
            metadata_version: 1,
            cancelled_at: null,
            created_at: at(-120),
            updated_at: at(-120),
            created_by_user_id: 'user-1',
            updated_by_user_id: 'user-1',
          },
        ]
      case 'calendar_resources':
        return [
          {
            id: 'resource-1',
            workspace_id: 'ws-1',
            project_id: null,
            name: 'Ambr 250 bay 2',
            code: 'AMB-2',
            resource_type: 'equipment',
            location: 'Bay 2',
            capacity: 1,
            timezone: 'Europe/London',
            status: 'active',
            metadata: {},
            created_at: at(-1000),
            updated_at: at(-1000),
            created_by_user_id: null,
            updated_by_user_id: null,
          },
        ]
      case 'instruments':
        return [
          {
            id: 'resource-1',
            display_id: 'INS-0008',
            name: 'Ambr 250 bay 2',
            location: 'Bay 2',
            retired_at: null,
          },
          {
            id: 'resource-retired',
            display_id: 'INS-0006',
            name: 'Retired reader',
            location: null,
            retired_at: at(-100),
          },
        ]
      case 'my_work_items':
        // Only the materials preview reads the list now: the Inbox totals come
        // from `inbox_needs_action_counts`, a server-side count over every row
        // the caller can see, so the fake states the total there, not as rows.
        return []
      case 'work_item_views':
        return []
      case 'review_submissions':
        return fixture.reviews > 0
          ? [
              {
                id: 'submission-1',
                record_id: 'rec-review',
                revision_id: 'revision-1',
                due_at: at(72),
                submitted_by_user_id: 'user-2',
                submitted_at: at(-6),
              },
            ]
          : []
      case 'study_tasks':
        return [
          {
            id: 'task-1',
            project_id: '00000000-0000-4000-8000-000000000320',
            title: 'Clarification train selected',
            status: 'in_progress',
            due_at: at(96),
          },
        ]
      case 'rpc/project_list_summary':
        return [
          {
            id: '00000000-0000-4000-8000-000000000320',
            workspace_id: 'ws-1',
            key: 'aav9-process-transfer',
            title: 'AAV9 process transfer',
            status: 'active',
            display_id: 'PRJ-0217',
            client_id: null,
            client_code: null,
            client_name: null,
            modality: 'AAV9',
            stage: 'Clarification development',
            lead_user_id: 'user-1',
            lead_name: 'Gareth P.',
            default_reviewer_user_id: null,
            agreement_reference: null,
            started_on: '2026-08-03',
            revision: 3,
            created_at: at(-1000),
            updated_at: at(-2),
            archived_at: null,
            record_count: 20,
            experiment_count: 14,
            last_activity_at: at(-2),
          },
        ]
      default:
        return []
    }
  }

  const count = async (resource: string, query = '') => {
    if (resource === 'rpc/dataset_list_summary')
      return fixture.datasetsWithErrors
    if (resource === 'my_notifications') return fixture.unread
    if (resource === 'records') {
      if (query.includes('status=eq.approved')) return 9
      if (query.includes('status=eq.in_review')) return 2
      return 4
    }
    if (resource === 'calendar_bookings') return 1
    return 0
  }

  const rpc = async (name: string) => {
    if (name === 'inbox_needs_action_counts') {
      // The server's count over every needs-action row the caller can see,
      // seen state included — not the length of a `limit=200` preview.
      return [{ total: fixture.inbox, reviews: fixture.reviews }]
    }
    if (name === 'audit_events') {
      return {
        formatVersion: 1,
        events: [
          {
            sequence: 12,
            id: 'event-1',
            createdAt: at(-2),
            entityType: 'model',
            entityUuid: 'model-1',
            operation: 'publish',
            recordId: null,
            projectId: '00000000-0000-4000-8000-000000000320',
            actorUserId: 'user-2',
            actorName: 'Mei L.',
            actorCredentialId: null,
            clientId: null,
            payload: {},
          },
        ],
        hasMore: false,
        nextCursor: null,
      }
    }
    if (name === 'workspace_members_list') {
      return [{ user_id: 'user-2', name: 'Priya S.' }]
    }
    if (name === 'my_project_permissions') {
      return [
        {
          project_id: '00000000-0000-4000-8000-000000000320',
          can_view: true,
          can_edit: true,
          can_review: true,
          can_manage: false,
          client_portal: false,
          access_level: 'editor',
        },
      ]
    }
    return []
  }

  return { list, count, rpc }
})

vi.mock('#/lib/notebook-data', async (importOriginal) => {
  const actual = await importOriginal<typeof notebookData>()
  return { ...actual, notebookDataClient: fake }
})

vi.mock('#/components/v3/projects/project-data', async (importOriginal) => {
  const actual = await importOriginal<typeof projectData>()
  return {
    ...actual,
    fetchProjectSummaries: async () => [
      {
        id: '00000000-0000-4000-8000-000000000320',
        key: 'aav9-process-transfer',
        title: 'AAV9 process transfer',
        status: 'active',
        displayId: 'PRJ-0217',
        clientId: null,
        clientCode: null,
        clientName: null,
        modality: 'AAV9',
        stage: 'Clarification development',
        leadUserId: 'user-1',
        leadName: 'Gareth P.',
        defaultReviewerUserId: null,
        agreementReference: null,
        startedOn: '2026-08-03',
        revision: '3',
        archivedAt: null,
        updatedAt: '2026-09-25T08:00:00.000Z',
        experimentCount: 14,
      },
    ],
  }
})

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof router>()
  return {
    ...actual,
    createFileRoute: () => (options: object) => ({
      options,
      useRouteContext: () => ({
        context: {
          user: { id: 'user-1' },
          workspace: { id: 'ws-1', name: 'Process Development' },
        },
        shellCounts: fixture.shellInbox ? { inbox: fixture.shellInbox } : {},
      }),
    }),
    redirect: (options: unknown) => options,
    // The real Link spreads the props Base UI injects (role, class, handlers),
    // so the mock must too: a Button rendered as a Link is a `role="button"`.
    Link: ({
      to,
      children,
      params,
      search,
      ...rest
    }: React.ComponentProps<'a'> & {
      to?: unknown
      params?: unknown
      search?: unknown
    }) => {
      void params
      const suffix =
        search && typeof search === 'object'
          ? '?' +
            new URLSearchParams(
              Object.entries(search as Record<string, unknown>).map(
                ([key, value]) => [key, String(value)],
              ),
            ).toString()
          : ''
      return (
        <a href={`${typeof to === 'string' ? to : '#'}${suffix}`} {...rest}>
          {children}
        </a>
      )
    },
  }
})

afterEach(cleanup)

beforeEach(() => {
  fixture.inbox = 0
  fixture.reviews = 0
  fixture.datasetsWithErrors = 0
  fixture.unread = 0
  fixture.hasRecents = true
  fixture.shellInbox = null
  fixture.failing = []
})

function renderHome() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Home />
    </QueryClientProvider>,
  )
}

describe('Home landing', () => {
  it('sends a client viewer straight to the portal', async () => {
    const beforeLoad = Route.options.beforeLoad as (args: unknown) => unknown
    await expect(
      Promise.resolve().then(() =>
        beforeLoad({
          context: { auth: { workspace: { role: 'client_viewer' } } },
          location: { href: '/' },
        }),
      ),
    ).rejects.toEqual({ to: '/client-portal' })
    expect(
      await beforeLoad({
        context: { auth: { workspace: { role: 'member' } } },
        location: { href: '/' },
      }),
    ).toBeTruthy()
  })
})

describe('Home degrades one section at a time', () => {
  it('keeps the page and names the section whose read failed', async () => {
    fixture.inbox = 3
    fixture.reviews = 2
    fixture.failing = ['calendar_bookings']
    renderHome()

    expect(
      await screen.findByText('Part of Home could not be loaded.'),
    ).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Summary' })).toBeTruthy()
    expect(
      screen.getByRole('heading', { name: 'Awaiting your review' }),
    ).toBeTruthy()
    expect(
      screen.getAllByText(/bookings could not be loaded/i).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText('Home could not be loaded')).toBeNull()
  })

  it('still fails the whole page when the layout cannot be chosen', async () => {
    fixture.failing = ['workspace_settings']
    renderHome()
    expect(await screen.findByText('Home could not be loaded')).toBeTruthy()
  })
})

describe('Home pace', () => {
  it('renders the all-clear, what is coming, what could be picked up and a useful inspector when nothing is waiting', async () => {
    renderHome()

    expect(await screen.findByText('Nothing is waiting on you')).toBeTruthy()
    expect(screen.queryByText('One thing is waiting on you')).toBeNull()

    // Coming up: the booking, the project milestone and the planned end, each
    // with the reason it is on this page.
    const comingUp = screen
      .getByRole('heading', { name: 'Coming up' })
      .closest('section')!
    expect(within(comingUp).getByText('next 2 weeks')).toBeTruthy()
    expect(
      within(comingUp).getByRole('link', { name: /Ambr 250 bay 2/ }),
    ).toBeTruthy()
    expect(within(comingUp).getByText('You are booked')).toBeTruthy()
    expect(
      within(comingUp).getByRole('link', {
        name: 'Clarification train selected',
      }),
    ).toBeTruthy()
    expect(
      within(comingUp).getByText('AAV9 process transfer milestone'),
    ).toBeTruthy()
    expect(
      within(comingUp).getByRole('link', {
        name: 'Planned end of EXP-0149',
      }),
    ).toBeTruthy()

    // Pick something up: the person's own unfinished draft, not the approved one.
    const pickUp = screen
      .getByRole('heading', { name: 'Pick something up' })
      .closest('section')!
    expect(
      within(pickUp).getByRole('link', {
        name: 'Harvest clarification: 50 L confirmation run',
      }),
    ).toBeTruthy()
    expect(within(pickUp).getByText(/Draft/)).toBeTruthy()
    expect(within(pickUp).queryByText('VCD readings, day 6')).toBeNull()

    // Per-project approval progress from the project's own record counts.
    const projects = screen
      .getByRole('heading', { name: 'Your projects' })
      .closest('section')!
    expect(within(projects).getByText('9')).toBeTruthy()
    expect(within(projects).getByText(/of 14 approved/)).toBeTruthy()
    expect(within(projects).getByText('2 in review')).toBeTruthy()
    // The approval bar reports a value, not a sentence read as an image.
    const approval = within(projects).getByRole('progressbar', {
      name: /^Approval for /,
    })
    expect(approval.getAttribute('aria-valuenow')).toBe('9')
    expect(approval.getAttribute('aria-valuemax')).toBe('14')
    expect(approval.getAttribute('aria-valuetext')).toBe(
      '9 of 14 experiments approved',
    )

    // The approved recent is not a pick-up, so it continues the list.
    const continueWorking = screen
      .getByRole('heading', { name: 'Continue working' })
      .closest('section')!
    expect(
      within(continueWorking).getByRole('link', {
        name: 'VCD readings, day 6',
      }),
    ).toBeTruthy()

    // The inspector has something useful in every one of its states.
    expect(screen.getByText('Nothing booked for you today.')).toBeTruthy()
    // ADR-0054 — the free-instrument list is the registry, with its INS id, and
    // a retired instrument is not offered.
    expect(screen.getByText('Ambr 250 bay 2')).toBeTruthy()
    expect(screen.getByText('INS-0008')).toBeTruthy()
    expect(screen.queryByText('Retired reader')).toBeNull()
    expect(screen.getByText('Free all day')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Book an instrument' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'New experiment from a protocol' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Import instrument data' }),
    ).toBeTruthy()
    expect(screen.getByText(/Mei L\./)).toBeTruthy()
  })

  it('stays calm and names the one thing that is waiting (near-quiet)', async () => {
    fixture.inbox = 1
    fixture.reviews = 1
    renderHome()

    expect(await screen.findByText('One thing is waiting on you')).toBeTruthy()
    expect(screen.queryByText('Nothing is waiting on you')).toBeNull()
    expect(screen.getByText(/Review EXP-0131 is due/)).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Open review' }).getAttribute('href'),
    ).toBe('/review/revision-1')

    // The near-quiet page is still the calm surface, not the review table.
    expect(screen.getByRole('heading', { name: 'Coming up' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Summary' })).toBeNull()
  })

  it('renders the busy Home with its exact totals when several things are waiting', async () => {
    fixture.inbox = 3
    fixture.reviews = 2
    renderHome()

    const summary = await screen.findByRole('navigation', { name: 'Summary' })
    expect(summary.textContent).toContain('3 items')
    expect(screen.queryByText('Nothing is waiting on you')).toBeNull()
    expect(screen.queryByText('One thing is waiting on you')).toBeNull()
    expect(
      screen.getByRole('heading', { name: 'Awaiting your review' }),
    ).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Review' })).toHaveLength(1)

    // QA2-Home-1: every chip opens the set it counts, filtered.
    expect(
      within(summary)
        .getByRole('link', { name: /to review/ })
        .getAttribute('href'),
    ).toBe('/inbox?type=reviews')
    expect(
      within(summary)
        .getByRole('link', { name: /datasets with errors/ })
        .getAttribute('href'),
    ).toBe('/datasets?tab=issues')
    expect(
      within(summary)
        .getByRole('link', { name: /experiments in progress/ })
        .getAttribute('href'),
    ).toBe('/experiments?tab=inprogress')

    // QA2-Home-3: the awaiting row's name opens the review, like Continue
    // working's rows.
    expect(screen.getByText(/Stability hold/).closest('a')).not.toBeNull()
  })

  it('offers a way to open each recent-activity entry (QA2-Home-2)', async () => {
    fixture.inbox = 2
    renderHome()

    await screen.findByRole('navigation', { name: 'Summary' })
    // The fake event names no canonical product route, so the entry opens its
    // authoritative history rather than standing inert.
    expect(screen.getByRole('button', { name: /History/ })).toBeTruthy()
  })

  it('states the same inbox total as the sidebar badge, not the narrower home count', async () => {
    // The shell counts `state <> 'following'` (which includes done-today); the
    // home read counts only needs_action/overdue. One screen must not show two
    // numbers for the same work, so the shell's total wins.
    fixture.inbox = 3
    fixture.reviews = 2
    fixture.shellInbox = '7'
    renderHome()

    const summary = await screen.findByRole('navigation', { name: 'Summary' })
    expect(summary.textContent).toContain('7 items')
    expect(summary.textContent).not.toContain('3 items')
  })

  it('keeps the calm page keyboard reachable, with no negative tabindex', async () => {
    renderHome()
    await screen.findByText('Nothing is waiting on you')

    const interactive = [
      ...screen.getAllByRole('link'),
      ...screen.getAllByRole('button'),
    ]
    expect(interactive.length).toBeGreaterThan(10)
    for (const element of interactive) {
      // Base UI marks a link acting as a button with role="button" and
      // tabindex="0"; nothing in the calm page may leave the tab order.
      const tabindex = element.getAttribute('tabindex')
      expect(tabindex === null || Number(tabindex) >= 0).toBe(true)
      expect(element.getAttribute('aria-hidden')).toBeNull()
    }
    // Every calm-page link carries an accessible name.
    for (const link of screen.getAllByRole('link')) {
      expect(link.textContent.trim().length > 0).toBe(true)
    }
  })
})
