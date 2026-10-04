import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProjectsPage } from './projects-page'
import type { ProjectsSearch } from './projects-page'
import type { ProjectRow } from './types'
import type { ProjectActivityEvent } from './project-data'
import type * as ProjectData from './project-data'
import type * as NotebookData from '#/lib/notebook-data'

const { activity, milestones } = vi.hoisted(() => ({
  activity: vi.fn<() => Promise<ProjectActivityEvent[]>>(async () => []),
  milestones: vi.fn<() => { data: ProjectData.ProjectMilestone[] }>(() => ({
    data: [],
  })),
}))
vi.mock('./project-data', async (importOriginal) => ({
  ...(await importOriginal<typeof ProjectData>()),
  fetchProjectActivity: activity,
  fetchProjectMembers: async () => [],
  useProjectMilestones: milestones,
}))
vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal<typeof NotebookData>()),
  fetchRecordsForProject: async () => [],
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to?: unknown; children?: React.ReactNode }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
}))

afterEach(cleanup)

function row(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    uuid: '00000000-0000-4000-8000-000000000320',
    id: 'PRJ-0217',
    name: 'AAV9 process transfer',
    client: 'CL-017',
    modality: 'AAV9',
    stage: 'Tech transfer',
    lead: 'Gareth P.',
    experiments: 14,
    status: { tone: 'progress', label: 'In progress' },
    archived: false,
    updated: 100,
    ...overrides,
  }
}

function renderPage(
  projects: ProjectRow[],
  search: ProjectsSearch = {},
  meId?: string,
) {
  return render(
    <ProjectsPage
      projects={projects}
      me="Gareth P."
      meId={meId}
      search={search}
      setSearch={() => {}}
      onCreate={() => {}}
    />,
  )
}

describe('ProjectsPage', () => {
  it.each([
    ['Europe/London', '29 Sept'],
    ['UTC', '28 Sept'],
  ])(
    'renders due instants in %s without shifting date-only started_on',
    async (timezone, expected) => {
      milestones.mockReturnValue({
        data: [
          {
            id: 'milestone-1',
            name: 'Clarification train',
            status: 'planned',
            dueAt: '2026-09-28T23:00:00+00:00',
            timezone,
            linkedRecordId: null,
            linkedRecordIdentifier: null,
          },
        ],
      })
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      render(
        <QueryClientProvider client={client}>
          <ProjectsPage
            projects={[row({ started: '2026-09-29' })]}
            me="Gareth"
            search={{}}
            setSearch={() => {}}
            onCreate={() => {}}
          />
        </QueryClientProvider>,
      )
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Show details for AAV9 process transfer',
        }),
      )
      expect(
        await screen.findByText(`Clarification train · ${expected}`),
      ).toBeTruthy()
      expect(screen.getByText('29 Sept 2026')).toBeTruthy()
      milestones.mockReturnValue({ data: [] })
      client.clear()
    },
  )

  it('renders current record identity and distinguishes null, unresolved and known actors', async () => {
    const event = {
      id: 'event-1',
      sequence: 1,
      createdAt: '2026-10-04T10:00:00Z',
      entityType: 'record',
      entityUuid: '00000000-record-1',
      operation: 'update',
      recordId: '00000000-record-1',
      projectId: 'project-1',
      actorUserId: null,
      actorName: null,
      actorCredentialId: null,
      clientId: null,
      payload: {},
      currentActorName: null,
      currentRecord: {
        id: '00000000-record-1',
        identifier: 'SMP-23',
        title: 'Harvest lot',
      },
    }
    activity.mockResolvedValueOnce([
      event,
      { ...event, id: 'event-2', actorUserId: 'removed', currentRecord: null },
      {
        ...event,
        id: 'event-3',
        actorUserId: 'priya',
        currentActorName: 'Priya',
      },
    ])
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ProjectsPage
          projects={[row()]}
          me="Gareth"
          search={{}}
          setSearch={() => {}}
          onCreate={() => {}}
        />
      </QueryClientProvider>,
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Show details for AAV9 process transfer',
      }),
    )
    expect(await screen.findByText(/No recorded actor updated/)).toBeTruthy()
    expect(
      screen.getByText(/Unknown actor updated Record 00000000/),
    ).toBeTruthy()
    expect(screen.getByText(/Priya updated/)).toBeTruthy()
    expect(screen.getAllByTitle('Current record identity')).toHaveLength(2)
    expect(screen.getAllByText('SMP-23 · Harvest lot')).toHaveLength(2)
    expect(screen.queryByText(/A collaborator/)).toBeNull()
  })

  it('renders the design columns and tab counts', () => {
    renderPage([
      row(),
      row({
        id: 'PRJ-0214',
        name: 'LVV stability',
        status: { tone: 'review', label: 'In review' },
      }),
      row({ id: 'PRJ-0170', name: 'Old project', archived: true }),
    ])
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeTruthy()
    expect(screen.getAllByText('PRJ-0217').length).toBeGreaterThan(0)
    expect(screen.getAllByText('CL-017').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Tech transfer').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Gareth P.').length).toBeGreaterThan(0)
    // Archived project hidden by the default filter.
    expect(screen.queryByText('Old project')).toBeNull()
    // Tabs carry counts.
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0)
  })

  it('shows the empty state with no projects', () => {
    renderPage([])
    expect(screen.getByText('No projects yet')).toBeTruthy()
  })

  it('the explicit Archived URL view includes archives but excludes active projects', () => {
    renderPage(
      [row(), row({ id: 'PRJ-0170', name: 'Old project', archived: true })],
      { tab: 'archived' },
    )
    expect(
      screen.getByRole('button', { name: 'Show details for Old project' }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', {
        name: 'Show details for AAV9 process transfer',
      }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', {
        name: 'Remove filter: status is not Archived',
      }),
    ).toBeNull()
  })

  it('Mine uses the lead identity, not duplicate display names, and fields come from URL state', () => {
    renderPage(
      [
        row({ leadUserId: 'me' }),
        row({
          id: 'PRJ-0214',
          name: 'Other Gareth project',
          leadUserId: 'other',
        }),
      ],
      { tab: 'mine', fields: 'stage,experiments' },
      'me',
    )
    expect(screen.queryByText('Other Gareth project')).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Stage' })).toBeNull()
    expect(
      screen.queryByRole('columnheader', { name: 'Experiments' }),
    ).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Client' })).toBeTruthy()
  })
})
