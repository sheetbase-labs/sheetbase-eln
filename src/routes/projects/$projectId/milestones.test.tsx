import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import type { StudyTask } from '#/lib/planner'

import { Route } from './milestones'

let mockSearchState: Record<string, unknown> = {}

const mocks = vi.hoisted(() => ({
  role: 'member',
  canEdit: false,
  navigate: vi.fn(),
  fetchStudyTasks: vi.fn(),
  fetchStudyWorkstreams: vi.fn(),
  fetchMilestoneRisks: vi.fn(),
  fetchStudyDependencies: vi.fn(),
  fetchStudyDeliverables: vi.fn(),
  fetchStudyTaskDueChanges: vi.fn(),
  fetchProjectSummaries: vi.fn(),
  fetchWorkspaceMemberIdentities: vi.fn(),
  createStudyTask: vi.fn(),
  editStudyTask: vi.fn(),
  moveStudyTaskDue: vi.fn(),
  setStudyTaskClientVisible: vi.fn(),
  createPlanFromProject: vi.fn(),
  createStudyDeliverable: vi.fn(),
  setStudyDeliverableStatus: vi.fn(),
  linkStudyDeliverableEvidence: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useParams: () => ({ projectId: 'project-1' }),
    useSearch: () => mockSearchState,
    useRouteContext: () => ({
      context: {
        user: { id: 'gareth' },
        workspace: { id: 'ws', role: mocks.role },
      },
    }),
  }),
  useNavigate: () => mocks.navigate,
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}))

vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: {},
  notebookQueryKeys: { records: (id: string) => ['records', id] },
  fetchRecordsForProject: async () => [
    {
      id: 'r-12',
      identifier: 'EXP-0012',
      title: 'Release run',
      status: 'approved',
      archivedAt: null,
    },
  ],
}))

// QA-048: milestone writes are gated on the project's own edit permission, not
// the workspace role, so the route's permission read is stubbed here.
vi.mock('#/lib/workspace-access', () => ({
  fetchProjectPermissions: async () => ({
    can_view: true,
    can_edit: mocks.canEdit,
    can_review: mocks.canEdit,
    client_portal: false,
    can_manage: mocks.canEdit,
  }),
}))

vi.mock('#/components/v3/projects/project-data', () => ({
  PROJECTS_KEY: ['projects'],
  workspaceMemberQueryKeys: { identities: ['ui-port', 'workspace-members'] },
  fetchProjectSummaries: (...args: unknown[]) =>
    mocks.fetchProjectSummaries(...args),
  fetchWorkspaceMemberIdentities: (...args: unknown[]) =>
    mocks.fetchWorkspaceMemberIdentities(...args),
}))

vi.mock('#/components/v3/ui/sonner', () => ({ toast: vi.fn() }))

vi.mock('#/lib/planner', () => ({
  createStudyTask: (...args: unknown[]) => mocks.createStudyTask(...args),
  editStudyTask: (...args: unknown[]) => mocks.editStudyTask(...args),
  moveStudyTaskDue: (...args: unknown[]) => mocks.moveStudyTaskDue(...args),
  setStudyTaskClientVisible: (...args: unknown[]) =>
    mocks.setStudyTaskClientVisible(...args),
  createPlanFromProject: (...args: unknown[]) =>
    mocks.createPlanFromProject(...args),
  createStudyDeliverable: (...args: unknown[]) =>
    mocks.createStudyDeliverable(...args),
  setStudyDeliverableStatus: (...args: unknown[]) =>
    mocks.setStudyDeliverableStatus(...args),
  linkStudyDeliverableEvidence: (...args: unknown[]) =>
    mocks.linkStudyDeliverableEvidence(...args),
  fetchStudyTasks: (...args: unknown[]) => mocks.fetchStudyTasks(...args),
  fetchStudyWorkstreams: (...args: unknown[]) =>
    mocks.fetchStudyWorkstreams(...args),
  fetchMilestoneRisks: (...args: unknown[]) =>
    mocks.fetchMilestoneRisks(...args),
  fetchStudyDependencies: (...args: unknown[]) =>
    mocks.fetchStudyDependencies(...args),
  fetchStudyDeliverables: (...args: unknown[]) =>
    mocks.fetchStudyDeliverables(...args),
  fetchStudyTaskDueChanges: (...args: unknown[]) =>
    mocks.fetchStudyTaskDueChanges(...args),
  toStudyTask: (row: unknown) => row,
  describePlannerError: () => 'The plan could not be written.',
}))

afterEach(cleanup)

beforeEach(() => {
  vi.resetAllMocks()
  mockSearchState = {}
  mocks.role = 'member'
  mocks.canEdit = false
  mocks.fetchStudyTasks.mockResolvedValue([])
  mocks.fetchStudyWorkstreams.mockResolvedValue([])
  mocks.fetchMilestoneRisks.mockResolvedValue([])
  mocks.fetchStudyDependencies.mockResolvedValue([])
  mocks.fetchStudyDeliverables.mockResolvedValue([])
  mocks.fetchStudyTaskDueChanges.mockResolvedValue([])
  mocks.fetchProjectSummaries.mockResolvedValue([
    { id: 'project-1', title: 'AAV9 transfer', clientCode: 'CL-017' },
  ])
  mocks.fetchWorkspaceMemberIdentities.mockResolvedValue([
    { user_id: 'mei', name: 'Mei L.', role: 'member' },
  ])
})

function studyTask(overrides: Partial<StudyTask>): StudyTask {
  return {
    id: 'ms-1',
    workspaceId: 'ws',
    workstreamId: null,
    projectId: 'project-1',
    title: 'TFF and polish defined',
    description: null,
    taskType: 'milestone',
    status: 'not_started',
    priority: 'medium',
    startsAt: null,
    endsAt: null,
    dueAt: '2026-10-16T00:00:00Z',
    timezone: 'UTC',
    position: 0,
    color: null,
    progressPercent: 0,
    linkedExperimentRecordId: null,
    linkedExperimentIdentifier: null,
    linkedExperimentTitle: null,
    linkedProtocolRecordId: null,
    linkedProtocolIdentifier: null,
    approvalRequired: false,
    approvalStatus: 'not_required',
    clientVisible: false,
    sharedSince: null,
    clientVisibleReason: null,
    tags: [],
    metadataVersion: 3,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-20T00:00:00Z',
    assignments: [],
    resources: [],
    deliverables: [],
    ...overrides,
  }
}

function renderRoute() {
  const Component = Route.options.component
  if (!Component) throw new Error('Milestones component required')
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <Component />
    </QueryClientProvider>,
  )
}

describe('project milestones plan', () => {
  it('shows the empty state and the template section when the plan has no milestones', async () => {
    renderRoute()
    expect(await screen.findByText('No milestones yet')).toBeTruthy()
    expect(screen.getByText('Start from a template')).toBeTruthy()
    expect(
      screen.getByText(/No other project in this workspace has milestones/),
    ).toBeTruthy()
  })

  it('offers a real template when another project has a plan', async () => {
    mocks.fetchStudyTasks.mockResolvedValue([
      studyTask({ id: 'other-1', projectId: 'project-2' }),
    ])
    mocks.fetchProjectSummaries.mockResolvedValue([
      { id: 'project-1', title: 'AAV9 transfer', clientCode: 'CL-017' },
      { id: 'project-2', title: 'Process characterisation', clientCode: null },
    ])
    renderRoute()
    expect(await screen.findByText('No milestones yet')).toBeTruthy()
    expect(screen.getByText('Process characterisation')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Use this template…' }),
    ).toBeTruthy()
  })

  it('explains a denied plan and blocks the write affordances', async () => {
    mockSearchState = { state: 'denied' }
    mocks.fetchStudyTasks.mockResolvedValue([studyTask({})])
    renderRoute()
    expect(
      await screen.findByText(/You can view this plan but not change it/),
    ).toBeTruthy()
    const add = screen.getByRole('button', { name: 'Add milestone' })
    expect(
      add.hasAttribute('disabled') ||
        add.getAttribute('aria-disabled') === 'true',
    ).toBe(true)
  })

  it('explains the disabled add button on an empty plan for a viewer', async () => {
    mocks.canEdit = false
    renderRoute()
    expect(await screen.findByText('No milestones yet')).toBeTruthy()
    expect(
      await screen.findByText(/You can view this plan but not change it/),
    ).toBeTruthy()
    expect(screen.getByText(/Ask the project lead/)).toBeTruthy()
  })

  it('shows a load failure with a retry, not an empty plan', async () => {
    mocks.fetchStudyTasks.mockRejectedValueOnce(new Error('network'))
    renderRoute()
    expect(screen.queryByText('No milestones yet')).toBeNull()
    const retry = await screen.findByRole('button', { name: /try again/i })
    mocks.fetchStudyTasks.mockResolvedValue([])
    await userEvent.click(retry)
    expect(await screen.findByText('No milestones yet')).toBeTruthy()
  })

  it('lets an editor add a condition so a milestone with none can be marked done', async () => {
    mocks.canEdit = true
    mocks.fetchStudyTasks.mockResolvedValue([studyTask({})])
    mocks.createStudyDeliverable.mockResolvedValue({ id: 'd-1' })
    renderRoute()
    expect(
      await screen.findByText(/Add a condition to enable Mark done/),
    ).toBeTruthy()
    await userEvent.type(
      screen.getByLabelText('New condition'),
      'Release report signed',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }))
    await waitFor(() =>
      expect(mocks.createStudyDeliverable).toHaveBeenCalledWith(
        expect.anything(),
        { taskId: 'ms-1', name: 'Release report signed' },
      ),
    )
  })

  it('marks a condition met and links a record chosen from the project', async () => {
    mocks.canEdit = true
    mocks.fetchStudyTasks.mockResolvedValue([studyTask({})])
    mocks.fetchStudyDeliverables.mockResolvedValue([
      {
        id: 'd-1',
        taskId: 'ms-1',
        name: 'Release report signed',
        status: 'planned',
        linkedRecordId: null,
        linkedRecordIdentifier: null,
      },
    ])
    mocks.setStudyDeliverableStatus.mockResolvedValue({ id: 'd-1' })
    mocks.linkStudyDeliverableEvidence.mockResolvedValue({})
    renderRoute()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Mark met' }),
    )
    await waitFor(() =>
      expect(mocks.setStudyDeliverableStatus).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'd-1', status: 'delivered' },
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Link record' }))
    await userEvent.selectOptions(
      await screen.findByLabelText('Evidence record for Release report signed'),
      'EXP-0012',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Link' }))
    await waitFor(() =>
      expect(mocks.linkStudyDeliverableEvidence).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'd-1', recordIdentifier: 'EXP-0012' },
      ),
    )
  })

  // QA-048: the project's own edit permission decides, not the workspace role.
  it('lets a project editor without a governed-schema workspace role edit the plan', async () => {
    mocks.role = 'scientist'
    mocks.canEdit = true
    mocks.fetchStudyTasks.mockResolvedValue([studyTask({})])
    renderRoute()
    expect(
      (await screen.findAllByText('TFF and polish defined')).length,
    ).toBeGreaterThan(0)

    expect(
      screen.queryByText(/You can view this plan but not change it/),
    ).toBeNull()
    const add = screen.getByRole('button', { name: 'Add milestone' })
    expect(
      add.hasAttribute('disabled') ||
        add.getAttribute('aria-disabled') === 'true',
    ).toBe(false)
  })

  it('keeps a governed-schema workspace role read-only when the project does not grant edit', async () => {
    mocks.role = 'owner'
    mocks.canEdit = false
    mocks.fetchStudyTasks.mockResolvedValue([studyTask({})])
    renderRoute()
    expect(
      await screen.findByText(/You can view this plan but not change it/),
    ).toBeTruthy()
    const add = screen.getByRole('button', { name: 'Add milestone' })
    expect(
      add.hasAttribute('disabled') ||
        add.getAttribute('aria-disabled') === 'true',
    ).toBe(true)
  })

  it('shows the scale control, at-risk rule and the next date the client sees', async () => {
    mocks.fetchStudyTasks.mockResolvedValue([
      studyTask({ clientVisible: true, sharedSince: '2026-09-10T00:00:00Z' }),
    ])
    mocks.fetchMilestoneRisks.mockResolvedValue([
      {
        taskId: 'ms-1',
        projectId: 'project-1',
        dueAt: '2026-10-16T00:00:00Z',
        status: 'not_started',
        late: false,
        risk: 'at_risk',
        riskReason: 'Due within 14 days; 1 of 1 conditions still open',
        conditionsTotal: 1,
        conditionsOpen: 1,
        unfinishedDependencies: 0,
        blockingTitle: null,
      },
    ])
    renderRoute()
    expect(
      await screen.findByRole('radiogroup', { name: 'Timeline scale' }),
    ).toBeTruthy()
    expect(
      screen.getAllByText(/At risk means due within 14 days/).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getByText(/Next date CL-017 sees: TFF and polish defined/),
    ).toBeTruthy()
    expect(screen.getByText(/1 at risk/)).toBeTruthy()
  })

  it('shows a stale conflict banner with an explicit reload when a write loses the race', async () => {
    const user = userEvent.setup()
    mockSearchState = { m: 'ms-1' }
    mocks.canEdit = true
    mocks.fetchStudyTasks.mockResolvedValue([
      studyTask({ clientVisible: true, sharedSince: '2026-09-10T00:00:00Z' }),
    ])
    mocks.moveStudyTaskDue.mockRejectedValue(
      new DataClientError('SB001', 'metadata version mismatch', 409),
    )
    renderRoute()
    await user.click(await screen.findByRole('button', { name: 'Move date…' }))
    await user.type(
      await screen.findByPlaceholderText(
        'e.g. Material release slipped a week',
      ),
      'Material release slipped a week',
    )
    await user.click(screen.getByRole('button', { name: 'Move date' }))
    expect(await screen.findByText('This plan changed elsewhere')).toBeTruthy()
    expect(screen.getByText(/nothing was overwritten/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Reload plan' }))
    await waitFor(() =>
      expect(screen.queryByText('This plan changed elsewhere')).toBeNull(),
    )
  })

  // QA-053: the risk read calls an overdue milestone late, so the status column
  // must not answer a different question (a reviewer told us it was late).
  it('reads an overdue milestone as Late whatever its workflow status is', async () => {
    mocks.fetchStudyTasks.mockResolvedValue([
      studyTask({
        status: 'review',
        dueAt: '2026-09-01T00:00:00Z',
      }),
    ])
    renderRoute()
    expect((await screen.findAllByText('Late')).length).toBeGreaterThan(0)
    expect(screen.queryByText('In review')).toBeNull()
  })

  // QA-047: hiding a milestone needs a reason the server accepts, so it asks
  // for one in a dialog instead of a prompt that can be cancelled into ''.
  it('asks for a reason before hiding a milestone, and sends nothing on cancel', async () => {
    const user = userEvent.setup()
    mockSearchState = { m: 'ms-1' }
    mocks.canEdit = true
    mocks.fetchStudyTasks.mockResolvedValue([
      studyTask({ clientVisible: true, sharedSince: '2026-09-10T00:00:00Z' }),
    ])
    renderRoute()
    expect(
      (await screen.findAllByText('TFF and polish defined')).length,
    ).toBeGreaterThan(0)

    await user.click(screen.getByRole('checkbox', { name: 'Show to CL-017' }))
    const submit = await screen.findByRole('button', {
      name: 'Hide milestone',
    })
    expect(submit.hasAttribute('disabled')).toBe(true)
    expect(mocks.setStudyTaskClientVisible).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mocks.setStudyTaskClientVisible).not.toHaveBeenCalled()

    await user.click(screen.getByRole('checkbox', { name: 'Show to CL-017' }))
    await user.type(
      await screen.findByPlaceholderText('e.g. Not agreed with the client yet'),
      'Not agreed with the client yet',
    )
    await user.click(screen.getByRole('button', { name: 'Hide milestone' }))
    await waitFor(() =>
      expect(mocks.setStudyTaskClientVisible).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          clientVisible: false,
          reason: 'Not agreed with the client yet',
        }),
      ),
    )
  })
})
