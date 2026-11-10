import { choose } from '../../../../tests/unit/picker'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

import { DataClientError } from '#/lib/data-client'
import type { StudyTask, MilestoneRisk } from '#/lib/planner'
import type { ProjectSummary } from '#/components/projects/project-data'

type MilestonesSearch = typeof Route.types.searchSchema

let mockSearchState: MilestonesSearch = {}

const conditionSchema = z.object({
  p_task_id: z.string(),
  p_name: z.string(),
  p_due_at: z.string().nullable(),
})

const conditionStatusSchema = z.object({
  p_id: z.string(),
  p_status: z.literal('delivered'),
})

const evidenceSchema = z.object({ p_id: z.string(), p_record_id: z.string() })

const visibilitySchema = z.object({
  p_task_id: z.string(),
  p_expected_metadata_version: z.number(),
  p_client_visible: z.boolean(),
  p_reason: z.string().nullable(),
})

const mocks = {
  role: 'member',
  canEdit: false,
  fetchStudyTasks: vi.fn<() => Promise<StudyTask[]>>(),
  fetchMilestoneRisks: vi.fn<() => Promise<MilestoneRisk[]>>(),
  fetchStudyDeliverables: vi.fn<
    () => Promise<
      Array<{
        id: string
        taskId: string
        name: string
        status: 'planned'
        linkedRecordId: null
        linkedRecordIdentifier: null
      }>
    >
  >(),
  fetchProjectSummaries:
    vi.fn<
      () => Promise<Array<Pick<ProjectSummary, 'id' | 'title' | 'clientCode'>>>
    >(),
  moveStudyTaskDue: vi.fn(),
  setStudyTaskClientVisible:
    vi.fn<(args: z.infer<typeof visibilitySchema>) => Promise<null>>(),
  createStudyDeliverable:
    vi.fn<(args: z.infer<typeof conditionSchema>) => Promise<{ id: string }>>(),
  setStudyDeliverableStatus:
    vi.fn<
      (args: z.infer<typeof conditionStatusSchema>) => Promise<{ id: string }>
    >(),
  linkStudyDeliverableEvidence:
    vi.fn<
      (
        args: z.infer<typeof evidenceSchema>,
      ) => Promise<{ linkedRecordIdentifier: string }>
    >(),
}

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    'http://localhost',
  )

  if (url.pathname.endsWith('/project_permissions'))
    return Response.json([
      {
        can_view: true,
        can_edit: mocks.canEdit,
        can_review: mocks.canEdit,
        client_portal: false,
        can_manage: mocks.canEdit,
      },
    ])

  if (url.pathname.endsWith('/study_tasks'))
    return Response.json(
      (await mocks.fetchStudyTasks()).map((task) => ({
        id: task.id,
        workspace_id: task.workspaceId,
        workstream_id: task.workstreamId,
        project_id: task.projectId,
        title: task.title,
        description: task.description,
        task_type: task.taskType,
        status: task.status,
        priority: task.priority,
        starts_at: task.startsAt,
        ends_at: task.endsAt,
        due_at: task.dueAt,
        timezone: task.timezone,
        position: task.position,
        color: task.color,
        progress_percent: task.progressPercent,
        linked_experiment_record_id: task.linkedExperimentRecordId,
        linked_experiment_identifier: task.linkedExperimentIdentifier,
        linked_experiment_title: task.linkedExperimentTitle,
        linked_protocol_record_id: task.linkedProtocolRecordId,
        linked_protocol_identifier: task.linkedProtocolIdentifier,
        approval_required: task.approvalRequired,
        approval_status: task.approvalStatus,
        client_visible: task.clientVisible,
        shared_since: task.sharedSince,
        client_visible_reason: task.clientVisibleReason,
        tags: task.tags,
        metadata_version: task.metadataVersion,
        created_at: task.createdAt,
        updated_at: task.updatedAt,
      })),
    )

  if (url.pathname.endsWith('/project_list_summary'))
    return Response.json(
      (await mocks.fetchProjectSummaries()).map((p) => ({
        id: p.id,
        key: p.id,
        title: p.title,
        client_code: p.clientCode,
        status: 'active',
        updated_at: '2026-09-20',
        experiment_count: 0,
      })),
    )

  if (url.pathname.endsWith('/milestone_risks'))
    return Response.json(
      (await mocks.fetchMilestoneRisks()).map((r) => ({
        task_id: r.taskId,
        project_id: r.projectId,
        due_at: r.dueAt,
        status: r.status,
        late: r.late,
        risk: r.risk,
        risk_reason: r.riskReason,
        conditions_total: r.conditionsTotal,
        conditions_open: r.conditionsOpen,
        unfinished_dependencies: r.unfinishedDependencies,
        blocking_title: r.blockingTitle,
      })),
    )

  if (url.pathname.endsWith('/study_deliverables'))
    return Response.json(
      (await mocks.fetchStudyDeliverables()).map((d) => ({
        id: d.id,
        task_id: d.taskId,
        name: d.name,
        status: d.status,
        linked_record_id: d.linkedRecordId,
        linked_record_identifier: d.linkedRecordIdentifier,
        description: null,
        due_at: null,
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-20T00:00:00Z',
      })),
    )

  if (url.pathname.endsWith('/workspace_members_list'))
    return Response.json([{ user_id: 'mei', name: 'Mei L.', role: 'member' }])

  if (url.pathname.endsWith('/records'))
    return Response.json([
      {
        id: 'r-12',
        identifier: 'EXP-0012',
        title: 'Release run',
        status: 'approved',
        archived_at: null,
        kind: 'experiment',
        tags: [],
        structure_version: 1,
        metadata_version: 1,
      },
    ])

  if (url.pathname.endsWith('/move_study_task_due')) {
    try {
      await mocks.moveStudyTaskDue()

      return Response.json(null)
    } catch (error) {
      if (error instanceof DataClientError)
        return Response.json(
          { code: error.code, message: error.message },
          { status: error.status },
        )
      throw error
    }
  }

  if (url.pathname.endsWith('/set_study_task_client_visible'))
    return Response.json(
      await mocks.setStudyTaskClientVisible(
        visibilitySchema.parse(await new Response(init?.body).json()),
      ),
    )

  if (url.pathname.endsWith('/create_study_deliverable'))
    return Response.json(
      await mocks.createStudyDeliverable(
        conditionSchema.parse(await new Response(init?.body).json()),
      ),
    )

  if (url.pathname.endsWith('/update_study_deliverable'))
    return Response.json(
      await mocks.setStudyDeliverableStatus(
        conditionStatusSchema.parse(await new Response(init?.body).json()),
      ),
    )

  if (url.pathname.endsWith('/link_study_deliverable_evidence'))
    return Response.json(
      await mocks.linkStudyDeliverableEvidence(
        evidenceSchema.parse(await new Response(init?.body).json()),
      ),
    )

  return Response.json([])
})

const { Route } = await import('./milestones')
const { dropSharedReads } = await import('#/lib/data-client')

afterEach(() => {
  cleanup()
  dropSharedReads()
})

afterAll(() => vi.unstubAllGlobals())

beforeEach(() => {
  vi.resetAllMocks()
  mockSearchState = {}
  mocks.role = 'member'
  mocks.canEdit = false
  mocks.fetchStudyTasks.mockResolvedValue([])
  mocks.fetchMilestoneRisks.mockResolvedValue([])
  mocks.fetchStudyDeliverables.mockResolvedValue([])
  mocks.setStudyTaskClientVisible.mockResolvedValue(null)
  mocks.fetchProjectSummaries.mockResolvedValue([
    { id: 'project-1', title: 'AAV9 transfer', clientCode: 'CL-017' },
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

  const root = createRootRoute({
    beforeLoad: () => ({
      context: {
        user: { id: 'gareth' },
        workspace: { id: 'ws', role: mocks.role },
      },
    }),
  })

  const route = createRoute({
    getParentRoute: () => root,
    path: '/projects/$projectId/milestones',
    validateSearch: Route.options.validateSearch,
    component: Component,
  })

  const search = new URLSearchParams()

  if (mockSearchState.m !== undefined) search.set('m', mockSearchState.m)

  if (mockSearchState.scale !== undefined)
    search.set('scale', mockSearchState.scale)

  if (mockSearchState.state !== undefined)
    search.set('state', mockSearchState.state)

  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: ['/projects/project-1/milestones?' + search.toString()],
    }),
  })

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
      <RouterProvider router={router} />
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
      expect(mocks.createStudyDeliverable).toHaveBeenCalledWith({
        p_task_id: 'ms-1',
        p_name: 'Release report signed',
        p_due_at: null,
      }),
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
    mocks.linkStudyDeliverableEvidence.mockResolvedValue({
      linkedRecordIdentifier: 'EXP-0012',
    })
    renderRoute()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Mark met' }),
    )
    await waitFor(() =>
      expect(mocks.setStudyDeliverableStatus).toHaveBeenCalledWith({
        p_id: 'd-1',
        p_status: 'delivered',
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Link record' }))
    await choose(
      userEvent.setup(),
      'Evidence record for Release report signed',
      /EXP-0012/,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Link' }))
    await waitFor(() =>
      expect(mocks.linkStudyDeliverableEvidence).toHaveBeenCalledWith({
        p_id: 'd-1',
        p_record_id: 'r-12',
      }),
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
        expect.objectContaining({
          p_client_visible: false,
          p_reason: 'Not agreed with the client yet',
        }),
      ),
    )
  })
})
